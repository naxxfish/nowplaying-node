var express = require('express');
var app = express();
var compression = require('compression')
var flash = require('connect-flash')
var debug = require('debug')('nowplaying-node');
var MongoClient = require('mongodb').MongoClient;
var cookieParser = require('cookie-parser')
var bodyParser = require('body-parser')
var VERSION = "0.0.1"

var moment = require('moment')
var passport = require('passport')
var session = require('cookie-session')
, LocalStrategy = require('passport-local').Strategy;

try {
	var config = require('./config')
} catch (e)
{
	console.log("Not configured yet! -- boo! Copy config.js.EXAMPLE to config.js and customise it please!")
	process.exit()
}

var nowplaying = {}

MongoClient.connect(config.mongo.connectionString, function (err, db)
{
	if (err)
	{
		console.error(err)
		process.exit()
	}
	passport.use(new LocalStrategy( function (username, password, done) {
		process.nextTick(function () {
			if (password == "hackme")
			{
				return done(null, "bob")
			} else {
				return done (null, false, { message: "Invalid Password" })
			}
		})
	}));
	app.set('views', __dirname + '/views');
	app.set('view engine', 'ejs');
	app.use( session({ secret: config.sessionKeySecret }));
	
	app.use( compression({ threshold: 512 }) )
	app.use(cookieParser())	
	app.use(express.static(__dirname + '/wwwroot'));
	app.use(flash());
	app.use( bodyParser.json() );       // to support JSON-encoded bodies
	app.use( bodyParser.urlencoded() ); // to support URL-encoded bodies
	app.use(passport.initialize());
	app.use(passport.session());
	
	app.get('/version', function (req, res)
	{
		res.end(JSON.stringify({
			application: 'node-nowplaying',
			version: VERSION,
			author: "Chris Roberts"
		}))
	});
	
	function setField(obj, value, path)
	{
		if (path.length == 1)
		{
			return obj[path[0]] = value
		} else {
			var prop = path.shift()
			if (!obj[prop])
			{
				obj[prop] = {}
			}
			return setField(obj[prop], value, path)
		}
	}
	
	function updateNowPlaying(candidate, cb)
	{
		if (candidate['setShow'] != "on")
		{
			debug('updateNowPlaying', "Not setting show")
			delete candidate.show
		}
		delete candidate['setShow']
		if (candidate['setTrack'] != "on")
		{
			debug('updateNowPlaying', "Not setting track")
			delete candidate.track
		}
		delete candidate['setTrack']
		
		// enhance the candidate data here
		
		// merge/overwrite the current nowplaying object
		for (var j=0;j<Object.keys(candidate).length;j++)
		{
			var prop = Object.keys(candidate)[j]
			nowplaying[prop] = candidate[prop]
		}
		nowplaying['timestamp'] = moment().unix()
		
		var np = db.collection('NP')
		var history = db.collection('HISTORY')
		var show = db.collection('SHOWS')

		if (nowplaying.track)
		{
			history.update({}, nowplaying, {upsert: true}, function (err, doc) {
				debug('HistoryDBUpdate', "Updated nowplaying history", doc)
				if (err)
				{
					console.error(err)
					cb(err)
				} else {
					debug("HistoryDBUpdate", "History updated")
				}
				if (nowplaying.show)
				{
					show.update({'show.name': nowplaying.show.name}, nowplaying.show, {upsert: true}, function (err, doc) {
						debug('ShowUpdate', "Updated show", doc)
						if (err)
						{
							console.error(err)
							cb(err)
						} else {
							debug("ShowUpdate", "Show was updated")
							cb()
						}
					})
				} else {
					debug('HistoryDBUpdate', "not updating show, executing callback")
					cb()
				}
			})	
		}

	}
	
	function feedMe(data, cb) 
	{	
		console.log(data)
		var candidate = {}
		delete data['feedSecret']

		for (var i=0;i<Object.keys(data).length;i++)
		{
			var field = Object.keys(data)[i]
			debug('feedMe',"Field " + field)
			debug('feedMe', "Data " + data[field])
			if (data[field] == "")
			{
				// skip blanks
				continue
			}
			if (field.indexOf(".") != -1)
			{
				// nested data!
				var parts = field.split(/\./)
				var result = setField(candidate, data[field], parts)
				debug('feedMe:dottedFields', result)
			} else {
				candidate[field] = data[field]
			}
		}
		updateNowPlaying(candidate, cb)
	}
	
	app.get('/', function (req, res) {
		res.render('index', nowplaying)
	})
	
	app.post('/feed', function (req, res) {
		if (req.body.feedSecret == config.feedSecret)
		{
			feedMe(req.body, function (err){
				debug("feedMe cb", "fired!" ,err)
				if (err)
				{
					res.end(JSON.stringify({code:500,msg:err}))
				} else {
					res.end(JSON.stringify({code:200,msg:'OK'}))
				}
			})
			console.log("Current nowplaying object:")
			console.log(nowplaying)
		} else {
			res.end("{'error':'Not authorised'}")
		}
	});
	
	app.get('/feed/', function (req, res) {
		res.render('feed')
	})
	
	app.get('/nowplaying', function (req, res) {
		res.end(JSON.stringify(nowplaying))
	});
	
	app.get('/admin/login', function (req, res)
	{
		res.render('login', { user: req.user, message: req.flash('error') });
	});
	
	app.post('/admin/login', 
		passport.authenticate('local', { failureRedirect: '/admin/login', failureFlash: true }),
		function (req, res)
		{
			res.redirect('/admin')
		}
	);
	
	app.get('/admin/logout', function(req, res){
		req.logout();
		res.redirect('/admin/login');
	});
	
	app.get('/admin', ensureAuthenticated, function (req, res) {
		res.end("Heyo!")
	});
	
	var server = app.listen(3000, function () {
		console.log("Listening on port %d", server.address().port)
	});
	
	function ensureAuthenticated(req, res, next) {
		if (req.isAuthenticated()) { return next(); }
		res.redirect('/admin/login');
	}
})
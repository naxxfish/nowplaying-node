var express = require('express');
var app = express();
var compression = require('compression')
var flash = require('connect-flash')
var request = require('request')
var debug = require('debug')('nowplaying-node');
var MongoClient = require('mongodb').MongoClient;
var cookieParser = require('cookie-parser')
var bodyParser = require('body-parser')
var VERSION = "0.0.1"
var mb = require('musicbrainz')
var NB = require('nodebrainz')
var nb = new NB({userAgent: 'NodeNowPlaying/0.0.1 ( http://github.com/naxxfish/nowplaying-node )'})
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

	function mergeNowPlaying(candidate, cb)
	{
		// merge/overwrite the current nowplaying object
		for (var j=0;j<Object.keys(candidate).length;j++)
		{
			var prop = Object.keys(candidate)[j]
			nowplaying[prop] = candidate[prop]
		}
		if (nowplaying._locals)
		{
			delete nowplaying['_locals']
		}
		nowplaying['timestamp'] = moment().unix()
		
		var np = db.collection('NP')
		var history = db.collection('HISTORY')
		var show = db.collection('SHOWS')
		debug('going to update local metadata')
		try {
			if (nowplaying.track && (nowplaying.track.title || nowplaying.track.artist))
			{
				trackParts = "?"
				for (var n=0;n<Object.keys(nowplaying.track).length;n++)
				{
					var field = Object.keys(nowplaying.track)[n]
					var value = nowplaying.track[field]
					trackParts +=  encodeURIComponent(field) + "=" + encodeURIComponent(value) + "&"
				}
				debug('updateMeta', trackParts)
				request({method: "GET", uri: "http://localhost:7000/setmeta" + trackParts}, function (error, response, body) {
					console.log(body)
				})
			} else {
				if (nowplaying.show)
				{
					request.get("http://localhost:7000/setmeta?title="+ encodeURIComponent(nowplaying.show.name)) // set it to blank if we've got no track
				} else {
					request.get("http://localhost:7000/setmeta?title=EMFM") // set it to blank if we've got no track

				}
			}
		} catch (e)
		{
			console.error("Couldn't update local metadata")
		}
		if (nowplaying.track && nowplaying.track.title)
		{
			var track_history = nowplaying.track
			track_history.type = "track"
			track_history.timestamp = moment().unix()
			history.insert( track_history, function (err, doc) {
				debug('HistoryDBUpdate', "Updated nowplaying history", doc)
				if (err)
				{
					console.error(err)
					cb(err)
				} else {
					debug("HistoryDBUpdate", "History updated")
				}
			})	
		}
		if (nowplaying.show)
		{
			var show_history = nowplaying.show
			show_history.type = "show"
			show_history.timestamp = moment().unix()
			debug('merge', 'Logging show', show_history)
			show.update({'name': show_history.name, 'type': 'show'}, show_history, {upsert: true}, function (err, doc) {
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
			mergeNowPlaying(candidate, cb)
			return
		} else {
			delete candidate['setTrack']
			if (candidate.track && candidate.track['artist']!= "NA" && candidate.track.artist != "undefined")
			{
				try {
				nb.search('artist', {artist: candidate['track']['artist']} , 
				function (err, artists){
					console.log(artists)
					if (err )
					{
						debug('musicbrainz error', err)
						mergeNowPlaying(candidate, cb)
						return
					}
					if (artists.count == 0)
					{
						debug('musicbrainz', 'no artist match')
						mergeNowPlaying(candidate, cb)
						return
					}
					debug('musicbrainz OK')
					if (artist = artists.artist.shift())
					{
						debug('musicbrainz artist', artist)
						if (artist.score > 75)
						{
							debug('musicbrainz artist', 'Got a score of ' + artist.score + ', so using this data!')
							candidate.track.mb_arid = artist.id
							candidate.track.artist = artist.name
							nb.search('release',{'arid': candidate.track.mb_arid, release: candidate['track']['title'] }, function (err, releases) {
								debug('mb recordings', releases)
								if (err)
								{
									debug('mb recording error',err)
									mergeNowPlaying(candidate,cb)
									return
								}
								if (releases.count == 0)
								{
									debug('muscibrainz', 'no matching recording')
									mergeNowPlaying(candidate, cb)
									return
								}
								var release = releases.releases.shift()
								if (release)
								{
									debug("musicbrainz","got a recording!")
									debug(release)
									if (release.score > 90)
									{
										debug("musicbrainz", "recording scores highly!")
										candidate.track.title = release.title
										candidate.track.mb_rid = release.id
									} else {
										debug("musicbrainz", "recording doesn't score high enough")
									}
								} else {
									debug("no recording!")
								}
								mergeNowPlaying(candidate, cb)
							})
						} else {
							debug('musicbrainz artist', "Got a score of " + artist.score + " % - not good enough, not using")
							mergeNowPlaying(candidate,cb)
						}
					} else {
						mergeNowPlaying(candidate, cb)
					}
				})
				} catch (e)
				{
					console.log(error)
				}
			} else {
				candidate.track = {}
				mergeNowPlaying(candidate, cb)
			}
			
		}
		


	}
	
	function feedMe(data, cb) 
	{	
		debug('feedme',data)
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
		debug('app.get /')
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
		debug('app.get /nowplaying')
		res.end(JSON.stringify(nowplaying))
	});
	
	app.get('/history', function (req, res) {
		getHistory(res, 0)
	})
	function getHistory(res, since)
	{
		debug('app.get /history', 'since', since)
		db.collection('HISTORY').find({'timestamp': {$gt : since}}).toArray(function (err, docs) {
			debug('get history', docs)
			res.end(JSON.stringify(docs))
		})
	}

	app.get('/history/:since', function (req, res) {
		since = parseInt(req.params.since)
		getHistory(res, since)
	})
	
	var server = app.listen(3000, function () {
		console.log("Listening on port %d", server.address().port)
	});
	
	function ensureAuthenticated(req, res, next) {
		if (req.isAuthenticated()) { return next(); }
		res.redirect('/admin/login');
	}
})

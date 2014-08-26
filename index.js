var express = require('express');
var app = express();
var compression = require('compression')
var debug = require('debug')('nowplaying-node');
var MongoClient = require('mongodb').MongoClient;
var VERSION = "0.0.1"
var config = require('./config')
var moment = require('moment')

if (!config)
{
	console.log("Not configured yet! -- boo! Copy config.js.EXAMPLE to config.js and customise it please!")
	process.exit()
}


MongoClient.connect(config.mongo.connectionString, function (err, db)
{
	app.use( compression({ threshold: 512 }) )
	app.use(express.static(__dirname + '/wwwroot'));
	app.get('/version', function (req, resp)
	{
		resp.end(JSON.stringify({
			application: 'node-nowplaying',
			version: VERSION,
			author: "Chris Roberts"
		}))
	});
	var server = app.listen(3000, function () {
		console.log("Listening on port %d", server.address().port)
	})
})
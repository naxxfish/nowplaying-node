var icecast = require('icecast')
var devnull = require('dev-null')
var request = require('request')
var url = "http://catnap.in:8000/sustainer.mp3"
var config = require('./config')

icecast.get(config.streamURL, function (res) {
	console.error(res.headers)
	res.on('metadata', function (metadata)
	{
		console.log("Got some metadata!")
		var parsed = icecast.parse(metadata)
		console.error(parsed)
		var parts = parsed.StreamTitle.split(/ - /)
		request.post("http://localhost:3000/feed").form({
			'setTrack': 'on',
			'track.artist': parts[0],
			'track.title': parts[1],
			'feedSecret': config.feedSecret
		})
	})
		
	res.pipe(devnull())
})
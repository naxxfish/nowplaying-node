nowplaying-node
===============

Node.js nowplaying parsing filtering splurging machine

## Setup

First, copy `config.js.EXAMPLE` to `config.js` and edit it to suit your needs.

## Running

`node index.js` 

should do it

### icecast_reader.js

run this to feed your nowplaying engine with stuff off an Icecast mount.  Note that this only works for MP3 streams at the moment!
     node icecast_reader.js
'use strict'

const ipfsdFactory = require('ipfsd-ctl')

module.exports = {
  karma: {
    files: [{
      pattern: 'node_modules/interface-ipfs-core/test/fixtures/**/*',
      watched: false,
      served: true,
      included: false
    }],
    singleRun: false
  },
  hooks: {
    browser: {
      pre: ipfsdFactory.server.start,
      post: ipfsdFactory.server.stop
    }
  }
}


/* eslint-env mocha */
'use strict'

const hat = require('hat')
const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)

const ipfsExec = require('../utils/ipfs-exec')
const clean = require('../utils/clean')
const os = require('os')

const ipfsdFactory = require('ipfsd-ctl')

const isNode = require('detect-node')

let ipfsdController
if (isNode) {
  ipfsdController = ipfsdFactory.localController
} else {
  ipfsdController = ipfsdFactory.remoteController()
}

function off (tests) {
  describe('daemon off (directly to core)', () => {
    let thing = {}
    let repoPath

    before(function () {
      this.timeout(60 * 1000)

      repoPath = os.tmpdir() + '/ipfs-' + hat()
      thing.ipfs = ipfsExec(repoPath)
      thing.ipfs.repoPath = repoPath
      return thing.ipfs('init')
    })

    after(function (done) {
      this.timeout(26 * 1000)
      clean(repoPath)
      setImmediate(done)
    })

    tests(thing)
  })
}

function on (tests) {
  describe('daemon on (through http-api)', () => {
    let node
    let thing = {}

    before(function (done) {
      // CI takes longer to instantiate the daemon,
      // so we need to increase the timeout for the
      // before step
      this.timeout(60 * 1000)

      ipfsdController.spawn({ isJs: true }, (err, n) => {
        expect(err).to.not.exist()
        node = n
        thing.ipfs = ipfsExec(node.ctrl.repoPath)
        thing.ipfs.repoPath = node.ctrl.repoPath
        done()
      })
    })

    after(function (done) {
      this.timeout(60 * 1000)
      node.ctrl.stopDaemon(done)
    })

    tests(thing)
  })
}

/*
 * CLI Utility to run the tests offline (daemon off) and online (daemon on)
 */
exports = module.exports = (tests) => {
  off(tests)
  on(tests)
}

exports.off = off
exports.on = on

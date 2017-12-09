/* eslint max-nested-callbacks: ["error", 8] */
/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)

const parallel = require('async/parallel')
const series = require('async/series')
const ipfsExec = require('../utils/ipfs-exec')

const ipfsdFactory = require('ipfsd-ctl')

const isNode = require('detect-node')

let ipfsdController
if (isNode) {
  ipfsdController = ipfsdFactory.localController
} else {
  ipfsdController = ipfsdFactory.remoteController()
}

describe('swarm', () => {
  let bMultiaddr
  let ipfsA
  let nodes = []

  before(function (done) {
    // CI takes longer to instantiate the daemon, so we need to increase the
    // timeout for the before step
    this.timeout(80 * 1000)

    series([
      (cb) => {
        ipfsdController.spawn({
          isJs: true,
          config: {
            'Bootstrap': [],
            'Discovery.MDNS.Enabled': false
          }
        }, (err, n) => {
          expect(err).to.not.exist()
          nodes.push(n)
          ipfsA = ipfsExec(n.ctrl.repoPath)
          cb()
        })
      },
      (cb) => {
        ipfsdController.spawn({
          isJs: true,
          config: {
            'Bootstrap': [],
            'Discovery.MDNS.Enabled': false
          }
        }, (err, n) => {
          expect(err).to.not.exist()
          nodes.push(n)
          n.ctl.id((err, id) => {
            expect(err).to.not.exist()
            bMultiaddr = id.addresses[0]
            cb()
          })
        })
      }
    ], done)
  })

  after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

  describe('daemon on (through http-api)', function () {
    this.timeout(60 * 1000)

    it('connect', () => {
      return ipfsA('swarm', 'connect', bMultiaddr).then((out) => {
        expect(out).to.eql(`connect ${bMultiaddr} success\n`)
      })
    })

    it('peers', () => {
      return ipfsA('swarm peers').then((out) => {
        expect(out).to.eql(bMultiaddr + '\n')
      })
    })

    it('addrs', () => {
      return ipfsA('swarm addrs').then((out) => {
        expect(out).to.have.length.above(1)
      })
    })

    it('addrs local', () => {
      return ipfsA('swarm addrs local').then((out) => {
        expect(out).to.have.length.above(1)
      })
    })

    it('disconnect', () => {
      return ipfsA('swarm', 'disconnect', bMultiaddr).then((out) => {
        expect(out).to.eql(
          `disconnect ${bMultiaddr} success\n`
        )
      })
    })

    it('`peers` should not throw after `disconnect`', () => {
      return ipfsA('swarm peers').then((out) => {
        expect(out).to.be.empty()
      })
    })
  })
})

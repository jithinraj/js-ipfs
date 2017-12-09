/* eslint max-nested-callbacks: ["error", 8] */
/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)

const parallel = require('async/parallel')
const series = require('async/series')
const waterfall = require('async/waterfall')
const PeerInfo = require('peer-info')
const PeerId = require('peer-id')
const multiaddr = require('multiaddr')
const crypto = require('crypto')
const ipfsdFactory = require('ipfsd-ctl')
const IPFSFactory = require('../utils/ipfs-factory-instance')

const isNode = require('detect-node')

let ipfsdController
if (isNode) {
  ipfsdController = ipfsdFactory.localController
} else {
  ipfsdController = ipfsdFactory.remoteController()
}

const baseConf = {
  'Bootstrap': [],
  'Discovery.MDNS.Enabled': false
}

const base = '/ip4/127.0.0.1/tcp'

function peerInfoFromObj (obj, callback) {
  waterfall([
    (cb) => PeerInfo.create(PeerId.createFromB58String(obj.id), cb),
    (peer, cb) => {
      obj.addresses.forEach((a) => peer.multiaddrs.add(multiaddr(a)))
      cb(null, peer)
    }
  ], callback)
}

function addAndCat (node1, node2, data, callback) {
  waterfall([
    (cb) => node1.files.add(data, cb),
    (res, cb) => node2.files.cat(res[0].hash, cb),
    (buffer, cb) => {
      expect(buffer).to.deep.equal(data)
      cb()
    }
  ], callback)
}

describe.only('circuit interop', () => {
  describe('js relay', () => {
    let jsRelayAddrs
    let jsRelayNode

    beforeEach(function (done) {
      this.timeout(50 * 1000)
      ipfsdController.spawn({
        isJs: true,
        config: Object.assign({}, baseConf, {
          'Addresses.Swarm': [`${base}/35002`, `${base}/35001/ws`],
          'EXPERIMENTAL.relay.enabled': true,
          'EXPERIMENTAL.relay.hop.enabled': true
        })
      }, (err, node) => {
        expect(err).to.not.exist()
        jsRelayNode = node
        node.ctl.swarm.localAddrs((err, addrs) => {
          expect(err).to.not.exist()
          jsRelayAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
          done()
        })
      })
    })

    afterEach((done) => jsRelayNode.ctrl.stopDaemon(done))

    describe('jsWS <-> jsRelay <-> goTCP', function () {
      this.timeout(50 * 1000)
      let goTCP
      let goTCPAddrs
      let jsWS

      let nodes
      before((done) => {
        parallel([
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb),
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35004/ws`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb)
        ], (err, n) => {
          expect(err).to.not.exist()
          nodes = n
          nodes[0].ctl.id((err, id) => {
            expect(err).to.not.exist()
            goTCPAddrs = id.addresses.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            goTCP = nodes[0].ctl
            jsWS = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

      it('should do jsWS <-> jsRelay <-> goTCP', (done) => {
        const data = crypto.randomBytes(128)
        series([
          (cb) => jsWS.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => goTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => jsWS.swarm.connect(goTCPAddrs[0], cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(goTCP, jsWS, data, done)
        })
      })
    })

    describe('jsWS <-> jsRelay <-> jsTCP', function () {
      this.timeout(50 * 1000)
      let jsTCP
      let jsTCPAddrs
      let jsWS

      let nodes
      before((done) => {
        parallel([
          (cb) => ipfsdController.spawn({
            isJs: true,
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'EXPERIMENTAL.relay.enabled': true,
              'EXPERIMENTAL.relay.hop.enabled': false
            })
          }, cb),
          (cb) => ipfsdController.spawn({
            isJs: true,
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35004/ws`],
              'EXPERIMENTAL.relay.enabled': true,
              'EXPERIMENTAL.relay.hop.enabled': false
            })
          }, cb)
        ], (err, n) => {
          expect(err).to.not.exist()
          nodes = n
          nodes[0].ctl.swarm.localAddrs((err, addrs) => {
            expect(err).to.not.exist()
            jsTCPAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            jsTCP = nodes[0].ctl
            jsWS = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

      it('should do jsWS <-> jsRelay <-> jsTCP', (done) => {
        this.timeout(20 * 1000)
        const data = crypto.randomBytes(128)
        series([
          (cb) => jsWS.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => jsTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => jsWS.swarm.connect(jsTCPAddrs[0], cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(jsTCP, jsWS, data, done)
        })
      })
    })

    describe('goWS <-> jsRelay <-> goTCP', function () {
      this.timeout(50 * 1000)
      let goTCP
      let goTCPAddrs
      let goWS

      let nodes
      before((done) => {
        parallel([
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb),
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35004/ws`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb)
        ], (err, n) => {
          expect(err).to.not.exist()
          nodes = n
          nodes[0].ctl.id((err, id) => {
            expect(err).to.not.exist()
            goTCPAddrs = id.addresses.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            goTCP = nodes[0].ctl
            goWS = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

      it('should do goWS <-> jsRelay <-> goTCP', (done) => {
        const data = crypto.randomBytes(128)
        series([
          (cb) => goWS.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => goTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => goWS.swarm.connect(goTCPAddrs[0], cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(goTCP, goWS, data, done)
        })
      })
    })

    describe('browser1 <-> jsRelay <-> browser2', function () {
      if (isNode) {
        return
      }

      this.timeout(40 * 1000)

      let factory

      let node1
      let node2

      // let nodeId1
      let nodeId2

      before(function (done) {
        this.timeout(40 * 1000)

        factory = new IPFSFactory()

        const base = {
          EXPERIMENTAL: {
            relay: {
              enabled: true
            }
          },
          Addresses: {
            Swarm: []
          }
        }

        parallel([
          (cb) => factory.spawnNode(null, base, cb),
          (cb) => factory.spawnNode(null, base, cb)
        ], (err, nodes) => {
          expect(err).to.not.exist()
          node1 = nodes[0]
          node2 = nodes[1]
          node2.id((err, id) => {
            expect(err).to.not.exist()
            peerInfoFromObj(id, (err, peerId) => {
              expect(err).to.not.exist()
              nodeId2 = peerId
              done()
            })
          })
        })
      })

      after((done) => factory.dismantle(done))

      it('should do browser1 <-> jsRelay <-> browser2', (done) => {
        const data = crypto.randomBytes(128)

        series([
          (cb) => node1.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => node2.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => node1.swarm.connect(nodeId2, cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(node1, node2, data, done)
        })
      })
    })

    describe('jsTCP <-> jsRelay <-> browser1', function () {
      if (isNode) {
        return
      }

      this.timeout(40 * 1000)

      let factory

      let node1
      let jsTCP
      let jsTCPAddrs

      before(function (done) {
        this.timeout(40 * 1000)

        factory = new IPFSFactory()

        const conf = {
          EXPERIMENTAL: {
            relay: {
              enabled: true
            }
          },
          Addresses: {
            Swarm: []
          }
        }

        parallel([
          (cb) => factory.spawnNode(null, conf, cb),
          (cb) => ipfsdController.spawn({
            isJs: true,
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'EXPERIMENTAL.relay.enabled': true,
              'EXPERIMENTAL.relay.hop.enabled': false
            })
          }, cb)
        ], (err, nodes) => {
          expect(err).to.not.exist()
          node1 = nodes[0]
          nodes[1].ctl.swarm.localAddrs((err, addrs) => {
            expect(err).to.not.exist()
            jsTCPAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            jsTCP = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => factory.dismantle(done))

      it('should do browser1 <-> jsRelay <-> browser2', (done) => {
        const data = crypto.randomBytes(128)

        series([
          (cb) => node1.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => jsTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => node1.swarm.connect(jsTCPAddrs[0], cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(node1, jsTCP, data, done)
        })
      })
    })
  })

  describe('go relay', () => {
    let goRelayAddrs
    let goRelayNode

    beforeEach(function (done) {
      this.timeout(50 * 1000)
      ipfsdController.spawn({
        config: Object.assign({}, baseConf, {
          'Addresses.Swarm': [`${base}/35002`, `${base}/35001/ws`],
          'Swarm.DisableRelay': false,
          'Swarm.EnableRelayHop': true
        })
      }, (err, node) => {
        expect(err).to.not.exist()
        goRelayNode = node
        node.ctl.id((err, id) => {
          expect(err).to.not.exist()
          goRelayAddrs = id.addresses.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
          done()
        })
      })
    })

    afterEach((done) => goRelayNode.ctrl.stopDaemon(done))

    describe('jsWS <-> goRelay <-> goTCP', function () {
      this.timeout(50 * 1000)
      let goTCP
      let goTCPAddrs
      let jsWS

      let nodes
      before((done) => {
        parallel([
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb),
          (cb) => ipfsdController.spawn({
            isJs: true,
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35004/ws`],
              'EXPERIMENTAL.relay.enabled': true,
              'EXPERIMENTAL.relay.hop.enabled': false
            })
          }, cb)
        ], (err, n) => {
          expect(err).to.not.exist()
          nodes = n
          nodes[0].ctl.id((err, id) => {
            expect(err).to.not.exist()
            goTCPAddrs = id.addresses.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            goTCP = nodes[0].ctl
            jsWS = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

      it('should do jsWS <-> goRelay <-> goTCP', (done) => {
        const data = crypto.randomBytes(128)
        series([
          (cb) => jsWS.swarm.connect(goRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => goTCP.swarm.connect(goRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          // TODO: go doesn't seem to be able to fallback to circuit, it needs an explicit addr
          (cb) => jsWS.swarm.connect(`/p2p-circuit/ipfs/${multiaddr(goTCPAddrs[0]).getPeerId()}`, cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(jsWS, goTCP, data, done)
        })
      })
    })

    describe('jsTCP <-> goRelay <-> jsWS', function () {
      this.timeout(50 * 1000)
      let jsTCP
      let jsTCPAddrs
      let jsWS

      let nodes
      before((done) => {
        parallel([
          (cb) => ipfsdController.spawn({
            isJs: true,
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'EXPERIMENTAL.relay.enabled': true,
              'EXPERIMENTAL.relay.hop.enabled': false
            })
          }, cb),
          (cb) => ipfsdController.spawn({
            isJs: true,
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35004/ws`],
              'EXPERIMENTAL.relay.enabled': true,
              'EXPERIMENTAL.relay.hop.enabled': false
            })
          }, cb)
        ], (err, n) => {
          expect(err).to.not.exist()
          nodes = n
          nodes[0].ctl.swarm.localAddrs((err, addrs) => {
            expect(err).to.not.exist()
            jsTCPAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            jsTCP = nodes[0].ctl
            jsWS = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

      it('should do jsTCP <-> goRelay <-> jsWS', (done) => {
        const data = crypto.randomBytes(128)
        series([
          (cb) => jsTCP.swarm.connect(goRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => jsWS.swarm.connect(goRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => jsWS.swarm.connect(jsTCPAddrs[0], cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(jsTCP, jsWS, data, done)
        })
      })
    })

    describe('goTCP <-> goRelay <-> goWS', function () {
      this.timeout(50 * 1000)
      let goTCP
      let goTCPAddrs
      let goWS

      let nodes
      before((done) => {
        parallel([
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35003`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb),
          (cb) => ipfsdController.spawn({
            config: Object.assign({}, baseConf, {
              'Addresses.Swarm': [`${base}/35004/ws`],
              'Swarm.DisableRelay': false,
              'Swarm.EnableRelayHop': false
            })
          }, cb)
        ], (err, n) => {
          expect(err).to.not.exist()
          nodes = n
          nodes[0].ctl.id((err, id) => {
            expect(err).to.not.exist()
            goTCPAddrs = id.addresses.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
            goTCP = nodes[0].ctl
            goWS = nodes[1].ctl
            done()
          })
        })
      })

      after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

      it('should do goTCP <-> goRelay <-> goWS', (done) => {
        const data = crypto.randomBytes(128)
        series([
          (cb) => goWS.swarm.connect(goRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
          (cb) => goTCP.swarm.connect(goRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
          (cb) => setTimeout(cb, 1000),
          (cb) => goWS.swarm.connect(goTCPAddrs[0], cb)
        ], (err) => {
          expect(err).to.not.exist()
          addAndCat(goTCP, goWS, data, done)
        })
      })
    })
  })
})

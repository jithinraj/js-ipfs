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
const multiaddr = require('multiaddr')
const crypto = require('crypto')
const ipfsdFactory = require('ipfsd-ctl')

const isNode = require('detect-node')

let ipfsdController
if (isNode) {
  ipfsdController = ipfsdFactory.localController
} else {
  ipfsdController = ipfsdFactory.remoteController()
}

describe.only('circuit interop', () => {
  let jsTCP
  let jsTCPAddrs
  let jsWS
  let jsWSAddrs
  let jsRelayAddrs

  let goRelayAddrs
  let goTCPAddrs
  let goTCP
  // let goWSAddrs
  let goWS

  let ctrlNodes
  let apiNodes

  beforeEach(function (done) {
    this.timeout(50 * 1000)
    const base = '/ip4/127.0.0.1/tcp'

    parallel([
      (cb) => ipfsdController.spawn({
        isJs: true,
        config: {
          'Addresses.Swarm': [`${base}/35002`, `${base}/35001/ws`],
          'Addresses.API': `${base}/0`,
          'Addresses.Gateway': `${base}/0`,
          'Bootstrap': [],
          'Discovery.MDNS.Enabled': false,
          'EXPERIMENTAL.relay.enabled': true,
          'EXPERIMENTAL.relay.hop.enabled': true
        }
      }, cb),
      (cb) => ipfsdController.spawn({
        isJs: true,
        config: {
          'Addresses.Swarm': [`${base}/35003`],
          'Addresses.API': `${base}/0`,
          'Addresses.Gateway': `${base}/0`,
          'Bootstrap': [],
          'Discovery.MDNS.Enabled': false,
          'EXPERIMENTAL.relay.enabled': true,
          'EXPERIMENTAL.relay.hop.enabled': false
        }
      }, cb),
      (cb) => ipfsdController.spawn({
        isJs: true,
        config: {
          'Addresses.Swarm': [`${base}/35004/ws`],
          'Addresses.API': `${base}/0`,
          'Addresses.Gateway': `${base}/0`,
          'Bootstrap': [],
          'Discovery.MDNS.Enabled': false,
          'EXPERIMENTAL.relay.enabled': true,
          'EXPERIMENTAL.relay.hop.enabled': false
        }
      }, cb),
      (cb) => ipfsdController.spawn({
        config: {
          'Addresses.Swarm': [`${base}/35005/ws`, `${base}/35006`],
          'Addresses.API': `${base}/0`,
          'Addresses.Gateway': `${base}/0`,
          'Bootstrap': [],
          'Discovery.MDNS.Enabled': false,
          'Swarm.DisableRelay': false,
          'Swarm.EnableRelayHop': true
        }
      }, cb),
      (cb) => ipfsdController.spawn({
        config: {
          'Addresses.Swarm': [`${base}/35007`],
          'Addresses.API': `${base}/0`,
          'Addresses.Gateway': `${base}/0`,
          'Bootstrap': [],
          'Discovery.MDNS.Enabled': false,
          'Swarm.DisableRelay': false,
          'Swarm.EnableRelayHop': false
        }
      }, cb),
      (cb) => ipfsdController.spawn({
        config: {
          'Addresses.Swarm': [`${base}/35008/ws`],
          'Addresses.API': `${base}/0`,
          'Addresses.Gateway': `${base}/0`,
          'Bootstrap': [],
          'Discovery.MDNS.Enabled': false,
          'Swarm.DisableRelay': false,
          'Swarm.EnableRelayHop': false
        }
      }, cb)
    ], (err, nodes) => {
      expect(err).to.not.exist()

      ctrlNodes = nodes.map((node) => node.ctrl)
      apiNodes = nodes.map((node) => node.ctl)

      parallel([
        (cb) => apiNodes[0].swarm.localAddrs((err, addrs) => {
          expect(err).to.not.exist()
          jsRelayAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
          cb()
        }),
        (cb) => {
          jsTCP = apiNodes[1]
          cb()
        },
        (cb) => apiNodes[1].swarm.localAddrs((err, addrs) => {
          expect(err).to.not.exist()
          jsTCPAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
          cb()
        }),
        (cb) => {
          jsWS = apiNodes[2]
          cb()
        },
        (cb) => apiNodes[2].swarm.localAddrs((err, addrs) => {
          expect(err).to.not.exist()
          jsWSAddrs = addrs.map((a) => a.toString()).filter((a) => !a.includes('/p2p-circuit'))
          cb()
        }),
        (cb) => apiNodes[3].id((err, id) => {
          expect(err).to.not.exist()
          goRelayAddrs = id.addresses
          cb()
        }),
        (cb) => {
          goTCP = apiNodes[4]
          cb()
        },
        (cb) => apiNodes[4].id((err, id) => {
          expect(err).to.not.exist()
          goTCPAddrs = id.addresses
          cb()
        }),
        (cb) => {
          goWS = apiNodes[5]
          cb()
        },
        // (cb) => apiNodes[5].id((err, id) => {
        //   expect(err).to.not.exist()
        //   goWSAddrs = id.addresses
        //   cb()
        // })
      ], done)
    })
  })

  afterEach((done) => parallel(ctrlNodes.map((node) => (cb) => node.stopDaemon(cb)), done))

  it('jsWS <-> jsRelay <-> jsTCP', function (done) {
    this.timeout(20 * 1000)
    const data = crypto.randomBytes(128)
    series([
      (cb) => jsWS.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
      (cb) => jsTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
      (cb) => setTimeout(cb, 1000),
      (cb) => jsWS.swarm.connect(jsTCPAddrs[0], cb)
    ], (err) => {
      expect(err).to.not.exist()
      waterfall([
        (cb) => jsTCP.files.add(data, cb),
        (res, cb) => jsWS.files.cat(res[0].hash, cb),
        (buffer, cb) => {
          expect(buffer).to.deep.equal(data)
          cb()
        }
      ], done)
    })
  })

  it('goWS <-> jsRelay <-> goTCP', (done) => {
    const data = crypto.randomBytes(128)
    series([
      (cb) => goWS.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
      (cb) => goTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
      (cb) => setTimeout(cb, 1000),
      (cb) => goWS.swarm.connect(goTCPAddrs[0], cb)
    ], (err) => {
      expect(err).to.not.exist()
      waterfall([
        (cb) => goTCP.files.add(data, cb),
        (res, cb) => goWS.files.cat(res[0].hash, cb),
        (buffer, cb) => {
          expect(buffer).to.deep.equal(data)
          cb()
        }
      ], done)
    })
  })

  it('jsWS <-> jsRelay <-> goTCP', (done) => {
    const data = crypto.randomBytes(128)
    series([
      (cb) => jsWS.swarm.connect(jsRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
      (cb) => goTCP.swarm.connect(jsRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
      (cb) => setTimeout(cb, 1000),
      (cb) => jsWS.swarm.connect(goTCPAddrs[0], cb)
    ], (err) => {
      expect(err).to.not.exist()
      waterfall([
        (cb) => goTCP.files.add(data, cb),
        (res, cb) => jsWS.files.cat(res[0].hash, cb),
        (buffer, cb) => {
          expect(buffer).to.deep.equal(data)
          cb()
        }
      ], done)
    })
  })

  it('jsTCP <-> goRelay <-> jsWS', (done) => {
    const data = crypto.randomBytes(128)
    series([
      (cb) => jsTCP.swarm.connect(goRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
      (cb) => jsWS.swarm.connect(goRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
      (cb) => setTimeout(cb, 1000),
      (cb) => jsWS.swarm.connect(jsTCPAddrs[0], cb)
    ], (err) => {
      expect(err).to.not.exist()
      waterfall([
        (cb) => jsTCP.files.add(data, cb),
        (res, cb) => jsWS.files.cat(res[0].hash, cb),
        (buffer, cb) => {
          expect(buffer).to.deep.equal(data)
          cb()
        }
      ], done)
    })
  })

  it('goTCP <-> goRelay <-> goWS', (done) => {
    const data = crypto.randomBytes(128)
    series([
      (cb) => goWS.swarm.connect(goRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
      (cb) => goTCP.swarm.connect(goRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
      (cb) => setTimeout(cb, 1000),
      (cb) => goWS.swarm.connect(goTCPAddrs[0], cb)
    ], (err) => {
      expect(err).to.not.exist()
      waterfall([
        (cb) => goTCP.files.add(data, cb),
        (res, cb) => goWS.files.cat(res[0].hash, cb),
        (buffer, cb) => {
          expect(buffer).to.deep.equal(data)
          cb()
        }
      ], done)
    })
  })

  it('jsWS <-> goRelay <-> goTCP', (done) => {
    const data = crypto.randomBytes(128)
    series([
      (cb) => jsWS.swarm.connect(goRelayAddrs.filter(a => a.toString().includes('/ws'))[0], cb),
      (cb) => goTCP.swarm.connect(goRelayAddrs.filter(a => !a.toString().includes('/ws'))[0], cb),
      (cb) => setTimeout(cb, 1000),
      // TODO: go doesn't seem to be able to fallback to circuit, it needs an explicit addr
      (cb) => jsWS.swarm.connect(`/p2p-circuit/ipfs/${multiaddr(goTCPAddrs[0]).getPeerId()}`, cb)
    ], (err) => {
      expect(err).to.not.exist()
      waterfall([
        (cb) => jsWS.files.add(data, cb),
        (res, cb) => goTCP.files.cat(res[0].hash, cb),
        (buffer, cb) => {
          expect(buffer).to.deep.equal(data)
          cb()
        }
      ], done)
    })
  })
})

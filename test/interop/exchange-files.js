/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const series = require('async/series')
const parallel = require('async/parallel')
const waterfall = require('async/waterfall')
const crypto = require('crypto')
const pretty = require('pretty-bytes')
const randomFs = require('random-fs')
const promisify = require('promisify-es6')
const rimraf = require('rimraf')
const join = require('path').join
const os = require('os')

const rmDir = promisify(rimraf)

function tmpDir () {
  return join(os.tmpdir(), `ipfs_${String(Math.random()).substr(2)}`)
}

const ipfsdFactory = require('ipfsd-ctl')

const isNode = require('detect-node')

let ipfsdController
if (isNode) {
  ipfsdController = ipfsdFactory.localController
} else {
  ipfsdController = ipfsdFactory.remoteController()
}

const sizes = [
  1024,
  1024 * 62,
  // starts failing with spdy
  1024 * 64,
  1024 * 512,
  1024 * 768,
  1024 * 1023,
  1024 * 1024,
  1024 * 1024 * 4,
  1024 * 1024 * 8
]

const dirs = [
  5,
  10,
  50,
  100
]

describe('exchange files', () => {
  let goDaemon
  let jsDaemon
  let js2Daemon

  let nodes

  before(function (done) {
    this.timeout(100 * 1000)

    parallel([
      (cb) => ipfsdController.spawn(cb),
      (cb) => ipfsdController.spawn({ isJs: true }, cb),
      (cb) => ipfsdController.spawn({ isJs: true }, cb)
    ], (err, n) => {
      expect(err).to.not.exist()
      nodes = n
      goDaemon = nodes[0].ctl
      jsDaemon = nodes[1].ctl
      js2Daemon = nodes[2].ctl
      done()
    })
  })

  after((done) => parallel(nodes.map((node) => (cb) => node.ctrl.stopDaemon(cb)), done))

  it('connect go <-> js', function (done) {
    this.timeout(500 * 1000)

    let jsId
    let goId

    series([
      (cb) => parallel([
        (cb) => jsDaemon.id(cb),
        (cb) => goDaemon.id(cb)
      ], (err, ids) => {
        expect(err).to.not.exist()
        jsId = ids[0]
        goId = ids[1]
        cb()
      }),
      (cb) => goDaemon.swarm.connect(jsId.addresses[0], cb),
      (cb) => jsDaemon.swarm.connect(goId.addresses[0], cb),
      (cb) => parallel([
        (cb) => goDaemon.swarm.peers(cb),
        (cb) => jsDaemon.swarm.peers(cb)
      ], (err, peers) => {
        expect(err).to.not.exist()
        expect(peers[0].map((p) => p.peer.toB58String())).to.include(jsId.id)
        expect(peers[1].map((p) => p.peer.toB58String())).to.include(goId.id)
        cb()
      })
    ], done)
  })

  it('connect js <-> js', function (done) {
    this.timeout(500 * 1000)

    let jsId
    let js2Id

    series([
      (cb) => parallel([
        (cb) => jsDaemon.id(cb),
        (cb) => js2Daemon.id(cb)
      ], (err, ids) => {
        expect(err).to.not.exist()
        jsId = ids[0]
        js2Id = ids[1]
        cb()
      }),
      (cb) => js2Daemon.swarm.connect(jsId.addresses[0], cb),
      (cb) => jsDaemon.swarm.connect(js2Id.addresses[0], cb),
      (cb) => parallel([
        (cb) => js2Daemon.swarm.peers(cb),
        (cb) => jsDaemon.swarm.peers(cb)
      ], (err, peers) => {
        expect(err).to.not.exist()
        expect(peers[0].map((p) => p.peer.toB58String())).to.include(jsId.id)
        expect(peers[1].map((p) => p.peer.toB58String())).to.include(js2Id.id)
        cb()
      })
    ], done)
  })

  describe('cat file', () => sizes.forEach((size) => {
    it(`go -> js: ${pretty(size)}`, (done) => {
      const data = crypto.randomBytes(size)
      waterfall([
        (cb) => goDaemon.add(data, cb),
        (res, cb) => jsDaemon.cat(res[0].hash, cb)
      ], (err, file) => {
        expect(err).to.not.exist()
        expect(file).to.be.eql(data)
        done()
      })
    })

    it(`js -> go: ${pretty(size)}`, (done) => {
      const data = crypto.randomBytes(size)
      waterfall([
        (cb) => jsDaemon.add(data, cb),
        (res, cb) => goDaemon.cat(res[0].hash, cb)
      ], (err, file) => {
        expect(err).to.not.exist()
        expect(file).to.be.eql(data)
        done()
      })
    })

    it(`js -> js: ${pretty(size)}`, (done) => {
      const data = crypto.randomBytes(size)
      waterfall([
        (cb) => js2Daemon.add(data, cb),
        (res, cb) => jsDaemon.cat(res[0].hash, cb)
      ], (err, file) => {
        expect(err).to.not.exist()
        expect(file).to.be.eql(data)
        done()
      })
    })
  }))

  // TODO these tests are not fetching the full dir??
  describe('get directory', () => dirs.forEach((num) => {
    it(`go -> js: depth: 5, num: ${num}`, () => {
      const dir = tmpDir()
      return randomFs({
        path: dir,
        depth: 5,
        number: num
      }).then(() => {
        return goDaemon.util.addFromFs(dir, { recursive: true })
      }).then((res) => {
        const hash = res[res.length - 1].hash
        return jsDaemon.object.get(hash)
      }).then((res) => {
        expect(res).to.exist()
        return rmDir(dir)
      })
    })

    it(`js -> go: depth: 5, num: ${num}`, function () {
      this.timeout(6000)

      const dir = tmpDir()
      return randomFs({
        path: dir,
        depth: 5,
        number: num
      }).then(() => {
        return jsDaemon.util.addFromFs(dir, { recursive: true })
      }).then((res) => {
        const hash = res[res.length - 1].hash
        return goDaemon.object.get(hash)
      }).then((res) => {
        expect(res).to.exist()
        return rmDir(dir)
      })
    })

    it(`js -> js: depth: 5, num: ${num}`, function () {
      this.timeout(6000)

      const dir = tmpDir()
      return randomFs({
        path: dir,
        depth: 5,
        number: num
      }).then(() => {
        return js2Daemon.util.addFromFs(dir, { recursive: true })
      }).then((res) => {
        const hash = res[res.length - 1].hash
        return jsDaemon.object.get(hash)
      }).then((res) => {
        expect(res).to.exist()
        return rmDir(dir)
      })
    })
  }))
})

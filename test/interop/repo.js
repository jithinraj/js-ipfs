/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const waterfall = require('async/waterfall')
const crypto = require('crypto')
const os = require('os')
const path = require('path')
const hat = require('hat')

const ipfsdFactory = require('ipfsd-ctl')

const isNode = require('detect-node')

let ipfsdController
if (isNode) {
  ipfsdController = ipfsdFactory.localController
} else {
  ipfsdController = ipfsdFactory.remoteController()
}

function catAndCheck (api, hash, data, callback) {
  api.cat(hash, (err, fileData) => {
    expect(err).to.not.exist()
    expect(fileData).to.eql(data)
    callback()
  })
}

describe.only('repo', () => {
  it('read repo: go -> js', (done) => {
    const dir = path.join(os.tmpdir(), hat())
    const data = crypto.randomBytes(1024 * 5)

    let goDaemon
    let jsDaemon

    let hash
    waterfall([
      (cb) => ipfsdController.spawn({
        init: true,
        disposable: false,
        repoPath: dir
      }, cb),
      (node, cb) => {
        goDaemon = node
        goDaemon.ctl.add(data, cb)
      },
      (res, cb) => {
        hash = res[0].hash
        catAndCheck(goDaemon.ctl, hash, data, cb)
      },
      (cb) => goDaemon.ctrl.stopDaemon(cb),
      (cb) => ipfsdController.spawn({
        isJs: true,
        init: false,
        disposable: false,
        repoPath: dir
      }, cb),
      (node, cb) => {
        jsDaemon = node
        cb()
      },
      (cb) => catAndCheck(goDaemon.ctl, hash, data, cb),
      (cb) => jsDaemon.stopDaemon(cb)
    ], done)
  })

  // This was last due to an update on go-ipfs that changed how datastore is
  // configured
  // it.skip('read repo: js -> go', (done) => {
  //   const dir = path.join(os.tmpdir(), hat())
  //   const data = crypto.randomBytes(1024 * 5)
  //
  //   const jsDaemon = new JsDaemon({ init: true, disposable: false, path: dir })
  //   let goDaemon
  //
  //   let hash
  //   waterfall([
  //     (cb) => jsDaemon.start(cb),
  //     (cb) => jsDaemon.api.add(data, cb),
  //     (res, cb) => {
  //       hash = res[0].hash
  //       catAndCheck(jsDaemon, hash, data, cb)
  //     },
  //     (cb) => jsDaemon.stop(cb),
  //     (cb) => {
  //       goDaemon = new GoDaemon({ init: false, disposable: false, path: dir })
  //       goDaemon.start(cb)
  //     },
  //     (cb) => catAndCheck(goDaemon, hash, data, cb),
  //     (cb) => goDaemon.stop(cb)
  //   ], done)
  // })
})

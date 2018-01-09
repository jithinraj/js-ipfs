'use strict'

const promisify = require('promisify-es6')
const setImmediate = require('async/setImmediate')

module.exports = function dns () {
  return promisify((domain, opts, callback) => {
    if (typeof domain !== 'string') {
      return callback(new Error('Invalid arguments, domain must be a string'))
    }

    if (typeof opts === 'function') {
      callback = opts
      opts = {}
    }

    // TODO: implement recursive option

    require('dns').resolveTxt(domain, (err, records) => {
      if (err) {
        return callback(err, null)
      }

      for (const record of records) {
        if (record[0].startsWith('dnslink=')) {
          return callback(null, record[0].substr(7, record[0].length - 1))
        }
      }

      callback(new Error('Domain does not have an IPFS link', null))
    })

    // setImmediate(() => callback(null, data))
  })
}

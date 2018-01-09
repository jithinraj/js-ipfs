'use strict'

const dns = require('dns')

module.exports = (domain, opts, callback) => {
  domain = encodeURIComponent(domain)
  const url = `https://ipfs.io/api/v0/dns?arg=${domain}`

  for (const prop in opts) {
    url += `&${prop}=${opts[prop]}`
  }

  fetch(url, {mode: 'cors'})
    .then((response) => {
      const resp = response.json()
      if (resp.Path) {
        return callback(null, resp.Path)
      } else {
        return callback(new Error(resp.Message))
      }
    })
    .catch((error) => {
      callback(error)
    })
}

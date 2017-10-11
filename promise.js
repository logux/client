// Non-standard Promise implementation.
// Just to fix IndexedDB/Promise issue in Firefox.
// Based on Matthieu Sieben Promise implementation.

var undef

function Promise (cb) {
  var queue = []
  var ok, completed, result

  function complete (type, value) {
    if (!completed) {
      completed = true
      result = value
      ok = type === 0
      for (var i = 0; i < queue.length; i++) {
        queue[i]()
      }
    }
  }

  cb(complete.bind(undef, 0), complete.bind(undef, 1))

  this.then = then
  this.catch = then.bind(undef, undef)

  function then (success, error) {
    return new Promise(function (resolve, reject) {
      function done () {
        try {
          var val
          if (ok) {
            if (success) {
              val = success(result)
            } else {
              resolve(result)
              return
            }
          } else if (error) {
            val = error(result)
          } else {
            reject(result)
            return
          }
          if (val && val.then) {
            val.then(resolve, reject)
          } else {
            resolve(val)
          }
        } catch (e) {
          reject(e)
        }
      }

      if (completed) {
        done()
      } else {
        queue.push(done)
      }
    })
  }
}

module.exports = Promise

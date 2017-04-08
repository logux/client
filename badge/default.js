var refresh = require('./refresh.svg')
var success = require('./success.svg')
var offline = require('./offline.svg')
var error = require('./error.svg')

module.exports = {
  icons: {
    protocolError: refresh,
    synchronized: success,
    disconnected: offline,
    connecting: refresh,
    sending: refresh,
    error: error,
    wait: offline
  },
  base: {
    position: 'absolute',
    width: '200px',
    height: '50px',
    paddingLeft: '50px',
    opacity: '0.8',
    borderRadius: '5px',
    color: '#ffffff',
    fontSize: '13px',
    fontFamily: 'Helvetica Neue, sans-serif',
    zIndex: '100000',
    backgroundPosition: '15px center',
    backgroundRepeat: 'no-repeat'
  },
  text: {
    display: 'table-cell',
    verticalAlign: 'middle',
    height: '50px'
  },
  synchronized: {
    backgroundColor: '#000000'
  },
  disconnected: {
    backgroundColor: '#000000'
  },
  wait: {
    backgroundColor: '#000000'
  },
  sending: {
    backgroundColor: '#000000'
  },
  connecting: {
    backgroundColor: '#000000'
  },
  error: {
    backgroundColor: '#F42A2A'
  },
  protocolError: {
    backgroundColor: '#000000'
  }
}

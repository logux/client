var refresh = require('./refresh.svg')
var success = require('./success.svg')
var offline = require('./offline.svg')
var error = require('./error.svg')

module.exports = {
  base: {
    display: 'none',
    position: 'fixed',
    width: '15.4em',
    height: '4em',
    lineHeight: '1.4',
    margin: '1.5em',
    paddingLeft: '4.2em',
    opacity: '0.8',
    borderRadius: '0.4em',
    color: '#fff',
    fontFamily: 'Helvetica Neue, sans-serif',
    zIndex: '999',
    backgroundPosition: '1.2em center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '1.8em'
  },
  text: {
    display: 'table-cell',
    verticalAlign: 'middle',
    height: '4em'
  },
  synchronized: {
    display: 'block',
    backgroundColor: '#000',
    backgroundImage: 'url(' + success + ')'
  },
  disconnected: {
    display: 'block',
    backgroundColor: '#000',
    backgroundImage: 'url(' + offline + ')'
  },
  waitSync: {
    display: 'block',
    backgroundColor: '#000',
    backgroundImage: 'url(' + offline + ')'
  },
  sending: {
    display: 'block',
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  },
  connecting: {
    display: 'block',
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  },
  error: {
    display: 'block',
    backgroundColor: '#F42A2A',
    backgroundImage: 'url(' + error + ')'
  },
  protocolError: {
    display: 'block',
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  }
}

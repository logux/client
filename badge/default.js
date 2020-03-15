let refresh = require('./refresh.svg')
let success = require('./success.svg')
let offline = require('./offline.svg')
let error = require('./error.svg')

module.exports = {
  base: {
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
    backgroundColor: '#000',
    backgroundImage: 'url(' + success + ')'
  },
  disconnected: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + offline + ')'
  },
  wait: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + offline + ')'
  },
  sending: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  },
  error: {
    backgroundColor: '#F42A2A',
    backgroundImage: 'url(' + error + ')'
  },
  protocolError: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  }
}

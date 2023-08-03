import error from './error.svg'
import offline from './offline.svg'
import refresh from './refresh.svg'
import success from './success.svg'

export let badgeStyles = {
  base: {
    backgroundPosition: '1.2em center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '1.8em',
    borderRadius: '0.4em',
    color: '#fff',
    fontFamily: 'Helvetica Neue, sans-serif',
    height: '4em',
    lineHeight: '1.4',
    margin: '1.5em',
    opacity: '0.8',
    paddingLeft: '4.2em',
    position: 'fixed',
    width: '15.4em',
    zIndex: '999'
  },
  disconnected: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + offline + ')'
  },
  error: {
    backgroundColor: '#F42A2A',
    backgroundImage: 'url(' + error + ')'
  },
  protocolError: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  },
  sending: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + refresh + ')'
  },
  synchronized: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + success + ')'
  },
  text: {
    display: 'table-cell',
    height: '4em',
    verticalAlign: 'middle'
  },
  wait: {
    backgroundColor: '#000',
    backgroundImage: 'url(' + offline + ')'
  }
}

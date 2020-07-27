;(function () {
  'use strict'
  const of = function (name) {
    const bridgeKey = 'bridgejs_bridge_' + name
    let bridge = window[bridgeKey]
    if (bridge != null) return bridge
    bridge = {}
    window[bridgeKey] = bridge
    // create a message
    const createMessage = function (id, type, method, payload, error) {
      const message = {}
      if (id != null) message.id = id
      if (type != null) message.type = type
      if (method != null) message.method = method
      if (payload != null) message.payload = payload
      if (error != null) message.error = error
      return message
    }
    // bridge id, a guid
    const bridgeId = (function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0; var v = c === 'x' ? r : (r & 0x3 | 0x8)
        return v.toString(16)
      })
    }())
    // messages cached before hud load
    const messages = []
    let hubLoaded = false
    // send message
    const sendMessage = function (message, anyway = false) {
      message.from = bridgeId
      if (anyway === false) {
        if (hubLoaded === false) {
          messages.push(message)
          return
        }
      }
      const data = {}
      data[name] = message
      window.top.postMessage(data, '*')
    }
    // message seq id
    let _id = 0
    // emit
    bridge.emit = function (method, payload) {
      sendMessage(createMessage(_id++, 'emit', method, payload, null))
    }
    // deliver promise context
    const promiseContexts = {}
    // complete promiseContext
    // complete when bridge cancel , bridge unload, or server ack
    const completePromiseContextById = function (id, payload, error, automaticallyDelete = true) {
      const promiseContext = promiseContexts[id]
      if (promiseContext == null) {
        return
      }
      if (automaticallyDelete === true) {
        delete promiseContexts[id]
      }
      // should tell server to cancel
      if (error === 'cancelled' || error === 'disconnected') {
        sendMessage(createMessage(id, 'cancel', null, null, null))
      }
      if (promiseContext.timeoutContext != null) {
        window.clearTimeout(promiseContext.timeoutContext)
        promiseContext.timeout = null
      }
      if (error == null) {
        promiseContext.resolve(payload)
      } else {
        promiseContext.reject(error)
      }
    }
    // deliver
    bridge.deliver = function (method, payload) {
      const id = _id++
      sendMessage(createMessage(id, 'deliver', method, payload, null))
      const promiseContext = {}
      promiseContexts[id] = promiseContext
      const promise = new Promise(function (resolve, reject) {
        promiseContext.resolve = resolve
        promiseContext.reject = reject
      })
      promise.setTimeout = function (timeout) {
        if (promiseContext.timeoutContext != null) {
          window.clearTimeout(promiseContext.timeoutContext)
        }
        promiseContext.timeoutContext = window.setTimeout(function () {
          completePromiseContextById(id, null, 'timed out')
        }, timeout)
        return this
      }
      promise.setCancelToken = function (cancelToken) {
        cancelToken.cancel = function () {
          completePromiseContextById(id, null, 'cancelled')
        }
        return this
      }
      return promise
    }
    const handlers = {}
    bridge.on = function (method) {
      let handler = handlers[method]
      if (handler == null) {
        handler = {
          event: function (event) {
            this._event = event
            return this
          },
          cancel: function (cancel) {
            this._cancel = cancel
            return this
          }
        }
        handlers[method] = handler
      }
      return handler
    }
    const cancels = {}
    window.addEventListener('message', function ({ data, source }) {
      try {
        const message = data[name]
        if (message == null) {
          return
        }
        const { id, type, method, payload, error } = message
        // hub did load
        if (type === 'load') {
          if (source === window.top) {
            if (hubLoaded === true) {
              return
            }
            hubLoaded = true
            const handler = handlers.connect
            if (handler != null) {
              handler._event(payload, function () {})
            }
            sendMessage(createMessage(null, 'connect'))
            // send cached messages
            messages.forEach(function (element) {
              sendMessage(element)
            })
            messages.splice(0, messages.length)
          }
          return
        }
        // ack
        if (type === 'ack') {
          completePromiseContextById(id, payload, error)
          return
        }
        // cancel
        if (type === 'cancel') {
          const cancel = cancels[id]
          if (cancel == null) {
            return
          }
          cancel()
        }
        // emit
        if (type === 'emit') {
          const handler = handlers[method]
          if (handler == null) {
            return
          }
          handler._event(payload)
          return
        }
        // deliver
        if (type === 'deliver') {
          let completed = false
          const ack = function (id, payload, error) {
            sendMessage(createMessage(id, 'ack', null, payload, error))
          }
          const handler = handlers[method]
          if (handler == null) {
            ack(null, 'unsupported message')
            return
          }
          const cancelContext = handler._event(payload, function (payload, error) {
            if (completed === true) {
              return
            }
            completed = true
            ack(id, payload, error)
            delete cancels[id]
          })
          const cancel = handler._cancel
          if (cancel == null) {
            return
          }
          cancels[id] = function () {
            if (completed === true) {
              return
            }
            completed = true
            cancel(cancelContext)
            delete cancels[id]
          }
        }
      } catch (e) {
        console.log(e)
      }
    })
    const load = function () {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = 'https://bridgejs/load?name=' + encodeURIComponent(name)
      document.documentElement.appendChild(iframe)
      setTimeout(function () {
        document.documentElement.removeChild(iframe)
      }, 1)
    }
    const unload = function () {
      for (const id in promiseContexts) {
        sendMessage(createMessage(id, 'cancel', null, null, null))
        completePromiseContextById(id, null, 'disconnected', false)
      }
      sendMessage(createMessage(null, 'disconnect'))
    }
    window.addEventListener('unload', function () {
      unload()
    })
    load()
    return bridge
  }
  module.exports = { of }
})()
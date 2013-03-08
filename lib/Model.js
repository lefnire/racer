var EventEmitter = require('events').EventEmitter
  , Memory = require('./Memory')
  , eventRegExp = require('./path').eventRegExp
  , eachParent = require('./path').eachParent
  , mergeAll = require('./util').mergeAll
  , uuid = require('node-uuid')
  ;

module.exports = Model;

function Model (init) {
  for (var k in init) {
    this[k] = init[k];
  }
  this.flags || (this.flags = {});
  this._memory = new Memory();
  // Set max listeners to unlimited
  this.setMaxListeners(0);

  var cleanupCounts = 0
    , self = this
    , cleaning = false;
  this.on('newListener', function(name) {
    if (name !== 'cleanup') return;
    if (cleanupCounts++ < 128) return;
    cleanupCounts = 0;
    if (cleaning) return;
    cleaning = true;
    setTimeout(function() {
      self.emit('cleanup');
      cleaning = false;
    }, 10);
  });

  // Used for model scopes
  this._root = this;
  this.mixinEmit('init', this);

  // Used by .onPath()
  this._pathEvents = { descendants: {}, children: {}, self: {} };
  this.middleware = {};
  this.mixinEmit('middleware', this, this.middleware);
}

var modelProto = Model.prototype
  , emitterProto = EventEmitter.prototype;

mergeAll(modelProto, emitterProto, {
  id: function () {
    return uuid.v4();
  }

  /* Socket.io communication */

, connected: true
, canConnect: true

, _setSocket: function (socket) {
    this.socket = socket;
    this.mixinEmit('socket', this, socket);
    this.disconnect = function () {
      socket.disconnect();
    };
    this.connect = function (callback) {
      if (callback) socket.once('connect', callback);
      socket.socket.connect();
    };

    var self = this;
    this.canConnect = true;
    function onFatalErr (reason) {
      self.canConnect = false;
      self.emit('canConnect', false);
      onConnected();
      socket.disconnect();
      console.error('fatalErr', reason);
    }
    socket.on('fatalErr', onFatalErr);

    this.connected = false;
    function onConnected () {
      var connected = self.connected;
      self.emit(connected ? 'connect' : 'disconnect');
      self.emit('connected', connected);
      self.emit('connectionStatus', connected, self.canConnect);
    }

    socket.on('connect', function () {
      self.connected = true;
      onConnected();
    });

    socket.on('disconnect', function () {
      self.connected = false;
      // Slight delay after disconnect so that offline does not flash on reload
      setTimeout(onConnected, 400);
    });

    socket.on('error', function (err) {
      if (typeof err === 'string' && ~err.indexOf('unauthorized')) onFatalErr(err);
    });

    if (typeof window !== 'undefined') {
      // The server can ask the client to reload itself
      socket.on('reload', function () {
        window.location.reload();
      });
    }

    // Needed in case page is loaded from cache while offline
    socket.on('connect_failed', onConnected);
  }

  /* Scoped Models */

  /**
   * Create a model object scoped to a particular path.
   * Example:
   *     var user = model.at('users.1');
   *     user.set('username', 'brian');
   *     user.on('push', 'todos', function (todo) {
   *       // ...
   *     });
   *
   *  @param {String} segment
   *  @param {Boolean} absolute
   *  @return {Model} a scoped model
   *  @api public
   */
, at: function (segment, absolute) {
    var at = this._at
      , val = (at && !absolute)
            ? (segment === '')
              ? at
              : at + '.' + segment
            : segment.toString()
    return Object.create(this, { _at: { value: val } });
  }

, root: function () {
    return Object.create(this, { _at: { value: null } });
  }

  /**
   * Returns a model scope that is a number of levels above the current scoped
   * path. Number of levels defaults to 1, so this method called without
   * arguments returns the model scope's parent model scope.
   *
   * @optional @param {Number} levels
   * @return {Model} a scoped model
   */
, parent: function (levels) {
    if (! levels) levels = 1;
    var at = this._at;
    if (!at) return this;
    var segments = at.split('.');
    return this.at(segments.slice(0, segments.length - levels).join('.'), true);
  }

  /**
   * Returns the path equivalent to the path of the current scoped model plus
   * the suffix path `rest`
   *
   * @optional @param {String} rest
   * @return {String} absolute path
   * @api public
   */
, path: function (rest) {
    var at = this._at;
    if (at) {
      if (rest) return at + '.' + rest;
      return at;
    }
    return rest || '';
  }

  /**
   * Returns the last property segment of the current model scope path
   *
   * @optional @param {String} path
   * @return {String}
   */
, leaf: function (path) {
    if (!path) path = this._at || '';
    var i = path.lastIndexOf('.');
    return path.substr(i+1);
  }

  /* Model events */

  // EventEmitter.prototype.on, EventEmitter.prototype.addListener, and
  // EventEmitter.prototype.once return `this`. The Model equivalents return
  // the listener instead, since it is made internally for method subscriptions
  // and may need to be passed to removeListener.

, _on: emitterProto.on
, on: function (type, pattern, callback) {
    var self = this
      , listener = eventListener(type, pattern, callback, this);
    this._on(type, listener);
    listener.cleanup = function () {
      self.removeListener(type, listener);
    }
    return listener;
  }

, _once: emitterProto.once
, once: function (type, pattern, callback) {
    var listener = eventListener(type, pattern, callback, this)
      , self;
    this._on( type, function g () {
      var matches = listener.apply(null, arguments);
      if (matches) this.removeListener(type, g);
    });
    return listener;
  }
  /**
   * Adds a model listener to a subset of model paths.
   * This function stores listeners in separate arrays
   * for each path. This means that the listener isn't
   * called at all for other paths, saving loop time.
   *
   * @param {String}   type      The event type to add a handler for.  (typically 'mutator'; can also be a specific mutation event)
   * @param {String}   path      The path to listen for events in.  
   *                             Can optionally end in .* to only handle events on descendant path, or .? to only handle events on direct children.
   * @param {Function} listener  The event handler callback.  
   *                             Arguments are passed directly from original event.  
   *                             (unlike .on(type, pattern, callback), which uses expensive regexes to add args)
   * @return {Function}          The passed listener function, with a cleanup() function that removes the handler.  These handlers cannot be passed to removeListener()
   */
, onPath: function (type, path, listener) {
    if (this._at)
      path = this._at + '.' + path;

    if (path === "*") // If listening on all paths, we don't need anything special
      return this.on(type, listener); //This creates a cleanup() too.

    var self = this;

    if (!this._pathEvents.self[type])
      createPathListener(this, type);

    var eventObj;
    if (path.length > 2 && path.charAt(path.length - 2) === '.') {
      if (path.charAt(path.length - 1) === '*')
        eventObj = this._pathEvents.descendants[type];
      else if (path.charAt(path.length - 1) === '?')
        eventObj = this._pathEvents.children[type];
    }
    if (eventObj)
      path = path.substr(0, path.length - 2);
    else
      eventObj = this._pathEvents.self[type];

    var arr = eventObj[path] || (eventObj[path] = []);

    arr.push(listener);

    listener.cleanup = function () {
      var index = arr.indexOf(listener);
      if (index >= 0)
        arr.splice(index, 1);
      if (arr.length === 0)
        delete eventObj[path];
    };
    return listener;
  }

  /**
   * Used to pass an additional argument to local events. This value is added
   * to the event arguments in txns/mixin.Model
   * Example:
   *     model.pass({ ignore: domId }).move('arr', 0, 2);
   *
   * @param {Object} arg
   * @return {Model} an Object that prototypically inherits from the calling
   * Model instance, but with a _pass attribute equivalent to `arg`.
   * @api public
   */
, pass: function (arg) {
    return Object.create(this, { _pass: { value: arg } });
  }

, silent: function () {
    return Object.create(this, { _silent: { value: true } });
  }
});

modelProto.addListener = modelProto.on;

function createPathListener(model, type) {
  var childPathHandlers = model._pathEvents.children[type] = {};
  var descendantPathHandlers = model._pathEvents.descendants[type] = {};
  var selfPathHandlers = model._pathEvents.self[type] = {};

  model._on(type, function eventPathRaiser() {
    // Specific mutation events raise (methodArgs, out, other stuff)
    // The mutator event raises (method, eventArgs).  (eventArgs is an array of the arguments passed to the original event)
    // The beforeTxn event raises (method, methodArgs).
    // We cannot declare arguments in the handler or EventEmitter will falsely optimize

    var methodArgs;
    if (type === 'mutator')
      methodArgs = arguments[1][0];  // Extract the method's args from the original event args
    else if (type === 'beforeTxn')
      methodArgs = arguments[1];
    else
      methodArgs = arguments[0];
    var path = methodArgs[0];

    var self = this, args = arguments;

    raiseEvents(selfPathHandlers[path], self, args);

    eachParent(path, function (parentPath, index) {
      if (!index)
        raiseEvents(childPathHandlers[parentPath], self, args);

      raiseEvents(descendantPathHandlers[parentPath], self, args);
    });
  });
}
function raiseEvents(handlers, self, args) {
  if (!handlers) return;

  //TODO: Copy the handlers array? (slow)
  // (in case a later handler deletes an earlier one)
  for (var i = 0; i < handlers.length; i++) {
    var handler = handlers[i];
    handler.apply(self, args);

    // If the handler removed itself (or an earlier handler)
    // process the new handler in this position next time.
    if (handlers[i] !== handler)
      i--;
  }
}

/**
 * Returns a function that is assigned as an event listener on method events
 * such as 'set', 'insert', etc.
 *
 * Possible function signatures are:
 *
 * - eventListener(method, pattern, callback, at)
 * - eventListener(method, pattern, callback)
 * - eventListener(method, callback)
 *
 * @param {String} method
 * @param {String} pattern
 * @param {Function} callback
 * @param {String} at
 * @return {Function} function ([path, args...], out, isLocal, pass)
 */
function eventListener (method, pattern, callback, model) {
  if (model._at) {
    if (typeof pattern === 'string') {
      pattern = model._at + '.' + pattern;
    } else if (pattern.call) {
      callback = pattern;
      pattern = model._at;
    } else {
      throw new Error('Unsupported event pattern on scoped model');
    }

    // on(type, listener)
    // Test for function by looking for call, since pattern can be a RegExp,
    // which has typeof pattern === 'function' as well
  } else if ((typeof pattern === 'function') && pattern.call) {
    return pattern;
  }

  // on(method, pattern, callback)
  var regexp = eventRegExp(pattern)
    , listener

  if (method === 'mutator') {
    listener = function listenerModelMutator (mutatorMethod, _arguments) {
      var args = _arguments[0]
        , path = args[0];
      if (! regexp.test(path)) return;

      var callbackArgs = regexp.exec(path).slice(1);
      callbackArgs.push(mutatorMethod, _arguments);
      callback.apply(null, callbackArgs);
      return true;
    };
  } else {
    listener = function listenerModel (args, out, isLocal, pass) {
      var path = args[0];
      if (! regexp.test(path)) return;

      args = args.slice(1);
      var callbackArgs = regexp.exec(path).slice(1)
      callbackArgs.push.apply(callbackArgs, args);
      callbackArgs.push(out, isLocal, pass);
      callback.apply(null, callbackArgs);
      return true;
    };
  }

  function removeModelListener() {
    model.removeListener(method, listener);
    model.removeListener('removeModelListeners', removeModelListener);
  }
  model._on('removeModelListeners', removeModelListener);

  return listener;
}

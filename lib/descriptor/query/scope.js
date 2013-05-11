var QueryBuilder = require('./QueryBuilder')
  , queryTypes = require('./types')
  , pathUtils = require('../../path')
  , eachParent = pathUtils.eachParent
  , isImmediateChild = pathUtils.isImmediateChild
  , isGrandchild = pathUtils.isGrandchild
  , indexOf = require('../../util').indexOf
  , PRIVATE_COLLECTION = require('./types/constants').PRIVATE_COLLECTION
  ;

module.exports = setupQueryModelScope;

/**
 * Given a model, query, and the query's initial result(s), this function sets
 * up and returns a scoped model that is centered on a ref or refList that
 * embodies the query result(s) and updates those result(s) whenever a relevant
 * mutation should change the query result(s).
 *
 * @param {Model} model is the racer model
 * @param {MemoryQuery} memoryQuery or a TransformBuilder that has
 * MemoryQuery's syncRun interface
 * @param {[Object]|Object} initialResult is either an array of documents or a
 * single document that represents the initial result of the query over the
 * data currently loaded into the model.
 * @return {Model} a refList or ref scoped model that represents the query result(s)
 */
function setupQueryModelScope (model, memoryQuery, queryId, initialResult, dependencies, onRemoved) {
  var type = queryTypes[memoryQuery.type]
    , root = PRIVATE_COLLECTION + '.' + queryId;

  // TODO: This is a total hack. Fix the initialization of filters in client
  // and prevent filters from generating multiple listeners
  if (model[queryId])
    return type.getScopedModel(model, queryId);

  // This is called for query subscriptions without two parameters but with a callback
  if (typeof initialResult === 'function' && arguments.length === 4) {
    onRemoved = initialResult;
    initialResult = void 0;
  }

  if (typeof initialResult !== 'undefined') {
    type.assignInitialResult(model, queryId, initialResult);
  }
  
  var scopedModel = type.createScopedModel(model, memoryQuery, queryId, initialResult);

  model.set(root + '.ns', memoryQuery.ns);

  function resetResults() {
    //console.log("Rebuilding", memoryQuery.id);
    var searchSpace = model.get(memoryQuery.ns);
    type.onOverwriteNs(searchSpace, memoryQuery, model);
  }

  var listeners = []; // Used to remove all listeners when query is gone

  listeners.push(model.on("bulkUpdate", resetResults));

  // If this query is operating directly on the results
  // of another query, we must forward its ping events.
  // However, if this query type involves a refList, it
  // will forward the pings for us.
  if (!type.hasRef) {
    listeners.push(model.onPath('ping', memoryQuery.ns, function (path, result) {
      // If a different handler already set the result,
      // don't waste time forwarding it again.
      if (result.isUsed) return;
      model.emit('ping', scopedModel.path(), result);
    }));
  }

  // This listener must be added after the refList is set up
  // or the refList will fire duplicate item events.  (since
  // it try to forward the events that caused us to add each
  // item to our pointer list)
  listeners.push.apply(createMutatorListeners(model, scopedModel, memoryQuery, queryId));

  var creationTime = Date.now();
  function cleanup(full) {
    if (model.get(root)) {
      // Don't self-destruct queries right after they
      // are created. If a cleanup occurs immediately
      // the query is created, the client may not get
      // a chance to create the ref first.
      if (!full && Date.now() - creationTime < 3000) return;

      // Check whether there are any refs to the query
      var result = { isUsed: false };
      model.emit('ping', scopedModel.path(), result);

      if (result.isUsed) return;
      model.del(root);
    }
    delete model[queryId];

    for (var i = listeners.length; i--;) {
      listeners[i].cleanup();
    }
    listeners = null;

    if (onRemoved) onRemoved();
    return true;
  }

  listeners.push(
    model.on('cleanup', cleanup)
  );

  model[queryId] = listeners;
  // TODO: This is a total hack. Fix the initialization of filters in client
  // and prevent filters from generating multiple listeners

  if (dependencies) {
    // If a dependency is modified or replaced, rebuild the query
    dependencies.forEach(function (path) {
      listeners.push.apply(listeners,
        addNamespaceListeners(model, 'mutator', path, resetResults)
      );

      // If one of our dependencies is pinged, forward to our results
      listeners.push(model.onPath('ping', path, function (path, result) {
        // If a different handler already set the result,
        // don't waste time forwarding it again.
        if (result.isUsed) return;
        model.emit('ping', scopedModel.path(), result);
      }));
    });
  }

  return scopedModel;
}

/**
 * Adds a model listener that listens for changes inside a given namespace.
 * This will add the following scoped listeners:
 * - All child paths of ns
 * - ns itself
 * - Each parent property of ns, if any
 *
 * Thus, the listener is called if ns is replaced entirely, or if any property within ns changes.
 *
 * @returns {Array * Object} An array of listeners with cleanup methods that remove the listeners
 */
function addNamespaceListeners(model, event, ns, listener) {
  if (!ns)
    throw new Error("Cannot add namespace listeners to empty namespace");

  var listeners = [
    model.onPath(event, ns + ".*", listener),
    model.onPath(event, ns, listener)
  ];

  eachParent(ns, function (parentPath) {
    listeners.push(
      model.onPath(event, parentPath, listener)
    );
  });
  return listeners;
}
/**
 * Creates a listener of the 'mutator' event, for the type (e.g., findOne) of
 * query.
 * See the JSDocDoc of the function iniside the block to see what this listener
 * does.
 *
 * @param {Model} model is the racer model
 * @param {String} ns is the query namespace that points to the set of data we
 * wish to query
 * @param {Model} scopedModel is the scoped model that is scoped to the query
 * results
 * @param {Object} queryTuple is [ns, {queryMotif: queryArgs}, queryId]
 * @return {Array} An array of listener objects to remove
 */
function createMutatorListeners (model, scopedModel, memoryQuery, queryId) {
  var ns = memoryQuery.ns;
  var queryType = queryTypes[memoryQuery.type];

  // TODO Move this closer to MemoryQuery instantiation
  memoryQuery.id = queryId;

  // This listener only listens to events that replace the entire search domain.
  function queryOverwriteListener(method, _arguments) {
    var args = _arguments[0]
      , out = _arguments[1]
      , path = args[0]
      , i
      , l
      , doc;

    // The documents this query searches over, either as an Array or Object of
    // documents. This set of documents reflects that the mutation has already
    // taken place.
    var searchSpace = model.get(ns);
    if (!searchSpace) return;

    //console.log("Updating", memoryQuery.id, "due to", method, "of", path);

    if (method === 'set') {
      return queryType.onOverwriteNs(searchSpace, memoryQuery, model);
    }

    if (method === 'del') {
      return queryType.onRemoveNs(searchSpace, memoryQuery, model);
    }

    var currResult = scopedModel.get();
    if (currResult == null) currResult = queryType.resultDefault;

    if (method === 'push' || method === 'insert' || method === 'unshift') {
      var Model = model.constructor
        , docsToAdd = args[Model.arrayMutator[method].insertArgs];
      if (Array.isArray(docsToAdd)) {
        docsToAdd = docsToAdd.filter(function (doc) {
          // Ensure that the document is in the domain (it may not be if we are
          // filtering over some query results)
          return doesBelong(doc, searchSpace);
        });
        queryType.onInsertDocs(docsToAdd, memoryQuery, model, searchSpace, currResult);
      } else {
        doc = docsToAdd;
        // TODO Is this conditional if redundant? Isn't this always true?
        if (doesBelong(doc, searchSpace)) {
          queryType.onInsertDocs([doc], memoryQuery, model, searchSpace, currResult);
        }
      }
      return;
    }

    if (method === 'pop' || method === 'shift' || method === 'remove') {
      var docsToRm = out;
      for (i = 0, l = docsToRm.length; i < l; i++) {
        queryType.onRmDoc(docsToRm[i], memoryQuery, model, searchSpace, currResult);
      }
      return;
    }

    // TODO Is this the right logic for move?
    if (method === 'move') {
      var movedIds = out
        , onUpdateDocProperty = queryType.onUpdateDocProperty
        , docs = model.get(path)
      ;
      for (i = 0, l = movedIds.length; i < l; i++) {
        var id = movedIds[i];
        // TODO Ugh, this is messy
        if (Array.isArray(docs)) {
          doc = docs[indexOf(docs, id, equivId)];
        } else {
          doc = docs[id];
        }
        onUpdateDocProperty(doc, memoryQuery, model, searchSpace, currResult);
      }
      return;
    }
    throw new Error('Uncaught edge case: ' + method + ' ' + require('util').inspect(_arguments, false, null));
  }

  /**
   * This function will listen to the "mutator" event emitted by the model. The
   * purpose of listening for "mutator" here is to respond to changes to the
   * set of documents that the relevant query scans over to derive its search
   * results. Hence, the mutations it listens for are mutations on its search
   * domain, where that domain can be an Object of documents or an Array of documents.
   *
   * Fires callbacks by analyzing how model[method](_arguments...) has affected a
   * query searching over the Tree or Array of documents pointed to by ns.
   *
   * @param {String} method name
   * @param {Arguments} _arguments are the arguments for a given "mutator" event listener.
   * The arguments have the signature [[path, restOfMutationArgs...], out, isLocal, pass]
   */
  function queryModifiedListener(method, _arguments) {
    var args = _arguments[0]
      , out = _arguments[1]
      , path = args[0]
      , doc;

    // TODO: Eagerly getting refLists is very expensive. We should replace this
    // scopedModel.get() with a simple reference and memoize the query results

    // The documents this query searches over, either as an Array or Object of
    // documents. This set of documents reflects that the mutation has already
    // taken place.
    var searchSpace = model.get(ns);
    if (!searchSpace) return;

    //console.log("Updating", memoryQuery.id, "due to", method, "of", path);

    var currResult;

    // path = ns + suffix

    // The mutation can:
    if (isImmediateChild(ns, path)) {
      if (!queryType.noCurrResultOnDelete || method !== "del") {
        currResult = scopedModel.get() || queryType.resultDefault;
      }
      // (1) remove the document
      if (method === 'del') {
        return queryType.onRmDoc(out, memoryQuery, model, searchSpace, currResult);
      }

      // (2) add or over-write the document with a new version of the document
      if (method === 'set' || method === 'setNull') {
        doc = args[1];
        var belongs = doesBelong(doc, searchSpace);
        if (! out) {
          return queryType.onAddDoc(doc, out, memoryQuery, model, searchSpace, currResult);
        }
        if (doc.id === out.id) {
          return queryType.onAddDoc(doc, out, memoryQuery, model, searchSpace, currResult);
        }
      }
      throw new Error('Uncaught edge case: ' + method + ' ' + require('util').inspect(_arguments, false, null));
    }
    currResult = scopedModel.get() || queryType.resultDefault;

    if (isGrandchild(ns, path)) {
      var suffix = path.substring(ns.length + 1)
        , separatorPos = suffix.indexOf('.')
        , property = suffix.substring(0, ~separatorPos ? separatorPos : suffix.length)
        , isArray = Array.isArray(searchSpace)
        ;
      if (isArray) property = parseInt(property, 10);
      doc = searchSpace && searchSpace[property];
      if (doc) queryType.onUpdateDocProperty(doc, memoryQuery, model, searchSpace, currResult);
    }
  }

  var listeners = [
    model.onPath('mutator', ns + ".*", queryModifiedListener),
    model.onPath('mutator', ns, queryOverwriteListener)
  ];

  eachParent(ns, function (parentPath) {
    listeners.push(
      model.onPath('mutator', parentPath, queryOverwriteListener)
    );
  });
  return listeners;
}

function doesBelong (doc, searchSpace) {
  if (Array.isArray(searchSpace)) {
    return indexOf(searchSpace, doc.id, equivId) !== -1;
  }
  return doc.id in searchSpace;
}

function equivId (id, doc) {
  return doc && doc.id === id;
}

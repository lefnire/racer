var refUtils = require('./util')
  , RefListener = refUtils.RefListener
  , pathUtil = require('../path')
  , isPrivate = pathUtil.isPrivate
  , regExpPathOrParent = pathUtil.regExpPathOrParent
  , eachParent = pathUtil.eachParent
  , lookup = pathUtil.lookup
  , indexOf = require('../util').indexOf
  , indexOfFn = require('../util').indexOfFn
  , Model = require('../Model')
  , treeLookup = require('../tree').lookup
  , PRIVATE_COLLECTION = require('../descriptor/query/types/constants').PRIVATE_COLLECTION
  ;

exports = module.exports = createRef;

function createRef (model, from, to, key, hardLink) {
  if (!from)
    throw new Error('Missing `from` in `model.ref(from, to, key)`');
  if (!to)
    throw new Error('Missing `to` in `model.ref(from, to, key)`');

  var getter, refListener;
  if (key) {
    getter = createGetterWithKey(to, key, hardLink);
    refListener = setupRefWithKeyListeners(model, from, to, key, getter);
  } else {
    getter = createGetterWithoutKey(to, hardLink);
    refListener = setupRefWithoutKeyListeners(model, from, to, getter);
  }

  if (!isPrivate(to)) {
    // If the target of the reference is not private, it will never be pinged
  } else if (from.indexOf(PRIVATE_COLLECTION + '.') !== 0) {
    refListener.addPathListener('ping', to, function (path, result) { result.isUsed = true; });
  } else {
    // If this ref is part of a (findOne) query, forward
    // the event to any client-created refs.
    refListener.addPathListener('ping', to, function (path, result) {
      // If a different handler already set the result,
      // don't waste time forwarding it again.
      if (result.isUsed) return;
      model.emit('ping', from, result);
    });
  }
  return getter;
}

// TODO Rewrite *WithKey to work
/**
 * Returns a getter function that is assigned to the ref's `from` path. When a
 * lookup function encounters the getter, it invokes the getter in order to
 * navigate to the proper node in `data` that is pointed to by the ref. The
 * invocation also "expands" the current path to the absolute path pointed to
 * by the ref.
 *
 * @param {String} to path
 * @param {String} key path
 * @param {Boolean} hardLink
 * @return {Function} getter
 */
function createGetterWithKey (to, key, hardLink) {
  /**
   * @param {Function} lookup as defined in Memory.js
   * @param {Object} data is all data in the Model or the spec model
   * @param {String} path is the path traversed so far to the ref function
   * @param {[String]} props is the array of all properties that we want to traverse
   * @param {Number} len is the number of properties in props
   * @param {Number} i is the index in props representing the current property
   * we are at in our traversal of props
   * @return {[Object, String, Number]} [current node in data, current path,
   * current props index]
   */
  return function getterWithKey (data, pathToRef, rest, meta) {
    // TODO: Get to.RID$keyValue to avoid fetching entire domain refLists
    var toOut = treeLookup(data, to, null)
      , domain         = toOut.node
      , dereffedToPath = toOut.path

      , keyOut          = treeLookup(data, key, null)
      , id              = keyOut.node
      , path, node

    if (Array.isArray(domain)) {
      var index = indexOfFn(domain, function (doc) {
        return doc.id === id;
      });
      node = domain[index];
      path = dereffedToPath + '.' + index;
    } else if (! domain) {
      node = undefined;
      path = dereffedToPath + '.' + id;
    } else if (domain.constructor === Object) {
      node = domain[id];
      path = dereffedToPath + '.' + id;
    } else {
      throw new Error();
    }
    if (meta.refEmitter) {
      meta.refEmitter.onRef(node, path, rest, hardLink);
    }
    return {node: node, path: path};
  }
}

function setupRefWithKeyListeners (model, from, to, key, getter) {
  var refListener = new RefListener(model, from, getter)
    , toOffset = to.length + 1;

  refListener.add(to, function (path, method, args) {
    var newDocs, oldDocs;

    if (method === 'set') {
      var id = model.get(key);
      newDocs = args[1], oldDocs = args.out;
      if (Array.isArray(newDocs)) {
        args[1] = newDocs && newDocs[indexOf(newDocs, id, equivId)];
        args.out = oldDocs && oldDocs[indexOf(oldDocs, out, equivId)];
      } else {
        args[1] = newDocs && newDocs[id];
        args.out = oldDocs && oldDocs[id];
      }
    } else if (method === 'del') {
      oldDocs = args.out;
      if (Array.isArray(docs)) {
        args.out = oldDocs && oldDocs[indexOf(oldDocs, out, equivId)];
      } else {
        args.out = oldDocs && oldDocs[id];
      }
    } else {
      // TODO: Check array mutations for a doc matching our key
      return null;
    }

    return from;
  });

  refListener.add(to + '.*', function (path) {
    var keyPath = model.get(key) + '' // Cast to string
      , remainder = path.slice(toOffset);
    if (remainder === keyPath) return from;
    // Test to see if the remainder starts with the keyPath
    var index = keyPath.length;
    if (remainder.substring(0, index + 1) === keyPath + '.') {
      remainder = remainder.substring(index + 1, remainder.length);
      return from + '.' + remainder;
    }
    // Don't emit another event if the keyPath is not matched
    return null;
  });

  refListener.add(key, function (path, method, args) {
    var docs = model.get(to)
      , id
      , out = args.out
      ;
    if (method === 'set') {
      id = args[1];
      if (Array.isArray(docs)) {
        args[1] = docs && docs[ indexOf(docs, id, equivId) ];
        args.out = docs && docs[ indexOf(docs, out, equivId) ];
      } else {
        // model.get is used in case this points to a ref
        args[1] = model.get(to + '.' + id);
        args.out = model.get(to + '.' + out);
      }
    } else if (method === 'del') {
      if (Array.isArray(docs)) {
        args.out = docs && docs[ indexOf(docs, out, equivId) ];
      } else {
        // model.get is used in case this points to a ref
        args.out = model.get(to + '.' + out);
      }
    }
    return from;
  });

  return refListener;
}

function equivId (id, doc) {
  return doc && doc.id === id;
}

function createGetterWithoutKey (to, hardLink) {
  return function getterWithoutKey (data, pathToRef, rest, meta) {
    var prevRests = meta.prevRests || []
    prevRests.unshift(rest);
    var out = treeLookup(data, to, {prevRests: prevRests});
    prevRests.shift();
    if (meta.refEmitter) {
      meta.refEmitter.onRef(out.node, out.path, rest, hardLink);
    }
    return out;
  };
}

function setupRefWithoutKeyListeners(model, from, to, getter) {
  var refListener = new RefListener(model, from, getter)
    , toOffset = to.length + 1;

  refListener.add(to, function () {
    return from;
  });

  refListener.add(to + '.*', function (path) {
    return from + '.' + path.slice(toOffset);
  });

  eachParent(to, function (parentPath) {
    var remainder = to.slice(parentPath.length + 1)
    refListener.add(parentPath, function (path, method, args) {
      if (method === 'set') {
        args[1] = lookup(remainder, args[1]);
        args.out = lookup(remainder, args.out);
      } else if (method === 'del') {
        args.out = lookup(remainder, args.out);
      } else {
        // Don't emit an event if not a set or delete
        return null;
      }
      return from;
    });
  });

  return refListener;
}

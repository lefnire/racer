var util = require('../util')
  , indexOf = util.indexOf
  , indexOfFn = util.indexOfFn
  , refUtils = require('./util')
  , RefListener = refUtils.RefListener
  , Model = require('../Model')
  , treeLookup = require('../tree').lookup
  , pathLookup = require('../path').lookup
;

module.exports = createRefList;


// http://jsperf.com/multiple-startswith
function findPathIndex(pointerList, path) {
  for (var i = 0; i < pointerList.length; i++) {
    if ((pointerList[i].length === path.length || path.charAt(pointerList[i].length) === '.') && path.indexOf(pointerList[i]) === 0)
      return i;
  }
  return -1;
}

function createRefList (model, from, to, key) {
  if (!from || (!to && to !== "") || !key) {
    throw new Error('Invalid arguments for model.refList');
  }
  var arrayMutators = Model.arrayMutator
    , getter = createGetter(from, to, key)
    , refListener = new RefListener(model, from, getter)
    , toOffset = to ? to.length + 1 : 0;

  refListener.add(key, function (path, method, args) {
    var methodMeta = arrayMutators[method]
      , i = methodMeta && methodMeta.insertArgs;
    if (i) {
      var id, docs;
      docs = model.get(to);
      while ((id = args[i]) && id != null) {
        args[i] = (Array.isArray(docs))
          ? docs && docs[ indexOf(docs, id, function (id, doc) { return doc && doc.id === id; })  ]
          : docs && docs[id];
        // args[i] = model.get(to + '.' + id);
        i++;
      }
    }
    return from;
  });

  // TODO: Handle mutation of to itself (if the target array is replaced)

  // If this refList is hanging off the model
  // root, listen for all changes to check if
  // they match one of our paths.
  refListener.add((to ? to + '.*' : '*'), function (path) {
    // pointerList is an array of IDs or paths.
    // We do not know how many segments of this
    // (just-modified) path can be found within
    // pointerList (as opposed to properties on
    // the object inside the refList)
    var pointerList = model.get(key);
    if (!pointerList || pointerList.length === 0) return null;

    var subPath = path.slice(toOffset)
      , i = subPath.indexOf('.')
      , remainder

    if (i === -1) {
      // If there are no dots, look directly in the list
      i = pointerList.indexOf(subPath);
      if (i === -1)
        return null;
    } else {
      // If there are dots, first check whether the first
      // segment is the index of a document with an ID in
      // the pointerList (if the list refers to an array)
      remainder = subPath.substr(i + 1);
      var id = subPath.substr(0, i);
      id = model.get(to + '.' + id + '.id')

      if (typeof id !== "undefined")
        i = pointerList.indexOf(id);

      // If we couldn't find the ID, check if the
      // pointerList contains a nested path which
      // the modified path starts with.
      if (i === -1) {
        i = findPathIndex(pointerList, subPath);
        if (i === -1)
          return null;

        var pointedPath = pointerList[i];
        remainder = pointedPath === subPath ? "" : subPath.substr(pointedPath.length + 1)
      }
    }
    return remainder ?
      from + '.' + i + '.' + remainder :
      from + '.' + i;
  });

  return getter;
}

function createGetter (from, to, key) {
  /**
   * This represents a ref function that is assigned as the value of the node
   * located at `path` in `data`
   *
   * @param {Object} data is the speculative or non-speculative data tree
   * @param {String} pathToRef is the current path to the ref function
   * @param {[String]} rest is an array of properties representing the suffix
   * path we still want to lookup up on the dereferenced lookup
   * @param {Object} meta
   * @config {Array} [meta.prevRests]
   * @config {RefEmitter} [meta.refEmitter]
   * @return {Array} {node, path}
   */
  return function getterRefList (data, pathToRef, rest, meta) {
    if (!rest.length)
      rest = firstNonEmptyList(meta.prevRests) || rest;

    if (!rest.length) {
      var toOut = treeLookup(data, to)
        , domain = toOut.node || {} // formerly obj
        , dereffed = toOut.path

        , keyOut = treeLookup(data, key)
        , pointerList = keyOut.node
        , dereffedKey = keyOut.path
      ;
      var node = [];
      if (pointerList) {
        //console.warn("Building giant refList array:", pathToRef, '[', pointerList.length, ']');

        // returned node should be an array of dereferenced documents
        for (var k = 0, len = pointerList.length; k < len; k++) {
          var id = pointerList[k];
          node.push(getDoc(domain, id, to, pathToRef));
        }
      }

      if (meta.refEmitter) {
        meta.refEmitter.onRefList(node, pathToRef, rest, pointerList, dereffed, dereffedKey);
      }
      return { node: node, path: pathToRef };
    } else {
      // In case the pointerList is itself a refList,
      // recurse into its getter to avoid copying the
      // list of documents.
      if (rest.length === 1 && rest[0] === 'length') {
        rest.shift();
        return {
          node: fullLookup(data, key + ".length", rest, meta).node || 0, 
          path: pathToRef + '.length'
        };
      }
      var index = rest[0], id;
      if (typeof index === 'string' && index.indexOf('RID$') === 0) {
        // If we're being called recursively with an ID
        // from a chained refList, check that the ID is
        // contained in our keyList.
        var keys = treeLookup(data, key).node;
        id = index.substr(4);
        if (keys.indexOf(id) < 0)
          id = undefined;
      } else {
        // Otherwise, turn the index from the peeked 
        // path into an ID within the domain.
        id = fullLookup(data, key + "." + index, rest, meta).node;
      }
      if (typeof id === 'undefined') return { node: undefined, path: pathToRef + '.' + id };

      // We use this flag to tell nested refLists
      // to search for the ID inside pointerLists
      // rather than treating it as an index.  If
      // our pointerList isn't a refList, nothing
      // will consume the flag, so we will search
      // the domain ourselves. This makes sure we
      // don't copy domain unnecessarily.
      rest[0] = "RID$" + index;
      var restLen = rest.length;
      var node = fullLookup(data, to, rest, meta).node;
      if (rest.length === restLen) {
        // If the domain is not a refList, we must search here
        // node is now the full domain array; rest was ignored
        node = node && getDoc(node, id, to, pathToRef);
      } else {
        // The inner refList already got the single doc for us
      }

      if (meta.refEmitter) {
        meta.refEmitter.onRefListMember(node, pointerList, dereffedKey + '.' + index, dereffed, id, rest);
      }
      return { node: node, path: pathToRef + '.' + id };
    }
  };
}
function fullLookup(data, path, rest, meta){
  var prevRests = meta.prevRests || []

  // getterRefList can use a rest directly from prevRests
  var stolePrev = rest === prevRests[0];
  if (!stolePrev)
    prevRests.unshift(rest);
  var out = treeLookup(data, path, {prevRests: prevRests});
  if (!stolePrev)
    prevRests.shift();
  return out;
}
function getDoc (domain, id, to, pathToRef) {
  if (domain.constructor == Object) {
    // If the domain is an object, the ID can be
    // a possibly-nested path within the object.
    if (typeof id === 'string')
      return pathLookup(id, domain);
    else
      return domain[id];  //Take the fast path for numbers
  } else if (Array.isArray(domain)) {
    // If the domain is an array, the ID matches
    // the id property of an object in the array
    return domain[indexOfFn(domain, function (doc) {
      if (!doc) {
        console.warn(new Error('Unexpected'));
        console.warn("No doc", 'domain:', domain, 'refList to path:', to, 'pathToRef:', pathToRef);
      }
      return doc && doc.id == id;
    })]
  } else {
    throw new TypeError();
  }
}

function firstNonEmptyList (lists) {
  if (!lists) return;
  var i = 0, list;
  while (list = lists[i++]) {
    if (list.length) return list;
  }
}

#SLaks/racer

This is a fork of [codeparty/racer](https://github.com/codeparty/racer) maintained by [SLaks](http://slaks.net) to add features and bugfixes.

 > Racer is a real-time model synchronization engine for Node.js. It enables multiple users to interact with the same data objects via sophisticated conflict detection and resolution algorithms. At the same time, it provides a simple object accessor and event interface for writing application logic.

Racer does not have documentation.  For basic information, see the stock Derby documentation at http://derbyjs.com/#models

Issues and pull requests welcome.  
For support, see the [Google Group](https://groups.google.com/forum/?fromgroups#!forum/derbyjs).


[![Build
Status](https://secure.travis-ci.org/SLaks/racer.png)](http://travis-ci.org/SLaks/racer)

##Fork Usage

I have changed parts of how Racer and Derby interact with each-other, so SLaks/racer must be run with [Unroll-Me/Derby](https://github.com/Unroll-Me/derby) (and vice-versa).  
To prevent mistakes (and to make it easier to use forks of my projects), I removed Derby's npm dependency on Racer.

To get started, delete `node_modules/derby` and (if present) `node_module/racer`, and run

```shell
npm install --save git://github.com/SLaks/racer.git
npm install --save git://github.com/Unroll-Me/derby.git
```

I also have a [fork of Tracks](https://github.com/Unroll-Me/tracks), with some minor bugfixes, but it can be used independently of these forks.

#Changes from stock Racer

This fork contains the following changes (sorted by date descending; grouped by type).
Some of these changes have been pull-requested to stock Racer (not all of these pull requests have been accepted); others, particularly those that depend on Derby changes or involve more fundamental overhauls, have not.

##Breaking changes

 - Prevent all change events when re-building model  
When the server sends a complete snapshot of the model state, the client will no longer raise change events as it rebuilds everything.  
This is a major performance boost.  
However, any code that listens for model mutation events must now listen for the `bulkUpdate` event and rebuild everything.  
I modified Derby and Racer to do this everywhere.  
  - **Known issue**: There is no way to ensure that bulkUpdate handlers run in the correct order (if you have one set of change events that listens for changes made by a different set of change events).  Be careful.
  - If people want, I may add a config option to disable this behavior.

 - `model.on()` no longer returns the handler function (see [/97d170f](https://github.com/SLaks/racer/commit/97d170f7ee5731da58f7a804a580f7e5f0cd6de7) and [#113](https://github.com/codeparty/racer/issues/113))  
Adding the same function as a listener for two different events (or two
different onPath() paths) will overwrite the cleanup() functions.
This breaks query destruction for queries with dependencies (since
resetResults() is added for each dependency)  
I changed it to return a new object with a `cleanup()` function that removes only this listener)
Any code that uses the returned function (other than to call `cleanup()`)
will break.  This includes Derby, which I fixed in Unroll-Me/derby.  

 - No change events are raised when initializing the model on the client to match the state from the server.  
These aren't really changes; anything that listens for change events should have already caught them on the server.  
If you have custom change listeners with side-effects that Racer will not bundle by default, this may break that.

##New features
 - Allow pubsub transactions from external sources  
You can now write a pubsub adapter that raises txn events which originated outside the Racer ecosystem and do not have an associated model version.  
Racer will now forward any pubsub-received txns with version `-1` to all subscribed clients, regardless of their version.  

 - Allow custom socket.io querystring args (see [#108](https://github.com/codeparty/racer/issues/108))  
This is useful for CSRF protection in custom handshake handlers.  
You can set query strings on the server like this:  
```js
// The model._ioOptions property is a reference
// a shared object to store, so I need to clone
// it to add a per-request querystring.
model._ioOptions = Object.create(model._ioOptions);
model._ioOptions.query = "a=b&c=d";
```
 - Queries are now destroyed when no longer referenced (by a ref, refList, or by another query that is itself referenced).  
This happens whenever the `cleanup` event is raised; this event is raised by default every 127 model event handlers and when performing navigations in Derby.  

  - **Known bug**: If there are no other references to a query, and the `cleanup` event is raised in the middle of a `subscribe()` or `fetch()` call to the same query (eg, if you use the query, delete the refs to it, and then re-subscribe to an equivalent query before cleanup is raised), the query will be destroyed early.  
The fix is to add a temporary `onPath('ping')` handler until the subscribe finishes; I have not done this yet.  
To prevent this from happening when first subscribing to a new query, I prevent queries from destructing at all unless 5 seconds have passed since they were created  (to override this, `emit('cleanup', true)`).  This is a temporary fix.

 - Queries now support the `regex` operator  (see [#106](https://github.com/codeparty/racer/issues/106))    
Note that racer-db-mongo does not support the regex operator, so you cannot use it in query motifs.

 - Queries now support the `like` operator  (see [#97](https://github.com/codeparty/racer/issues/97))    
Note that racer-db-mongo does not support the like operator, so you cannot use it in query motifs.

 - Access control failures now return Error instances  
This allows promise frameworks like [Q](https://github.com/kriskowal/q) to build useful stack traces for failed operations invoked using promises.

 - Add `ping` event  
This event is used to determine whether a query has active references.

 - Add `model.onPath(type, path, listener)`  
Adds a model listener to a subset of model paths.  This function stores listeners in separate arrays for each path. This means that the listener isn't called at all for other paths, saving loop time.   
`event` can be `mutator`, `beforeTxn`, `ping`, or any specific mutation events.  Other events probably won't work, since it won't be able to extract the path that the event was raised on.  
The `path` argument can optionally end in .* to only handle events on descendant path, or .? to only handle events on direct children.  
Like my `model.on()`, this returns an object with a `cleanup()` method that removes the listener.  **This method is the only way to remove `onPath()` listeners**.

 - `count()` queries now update live when the model changes  (see [#91](https://github.com/codeparty/racer/issues/91S))  
  - **Known bug**: If a count query covers data which is not in the client's view of the model, it will update incorrectly.  
I'm not sure what the best way to fix this is; the query will need to know whether the client knows about its data.  
Racer 2 may make this simpler.

 - Multi-part refLists (see [mailing list](https://groups.google.com/forum/?fromgroups=#!topic/derbyjs/5xqPYTaGNEA))  
Keys in refLists can now contain `.` characters to traverse object paths.

 - Allow queries on model refs  (see [#70](https://github.com/codeparty/racer/issues/70))  
   Queries can now filter based on refs that are properties of the docs under the query


##Bug fixes
 - Don't crash if certain callbacks are missing  
I don't think I caught all cases of this yet; if you see "cannot invoke undefined" errors, let me know which callbacks I forgot to make optional

 - Allow pubsub events to be raised when not inside the txn middleware (see [#110](https://github.com/codeparty/racer/issues/110))  
This lets pubsub plugins raise events asynchronously.  Previously, any txn event received from pubsub that was not raised synchronously while processing the original txn would fail.  
This allows asynchronous plugins like [racer-pubsub-redis](https://github.com/codeparty/racer-pubsub-redis) to work.

 - Allow queries to be unsubscribed multiple times

 - Fix refList issues with nested paths (see [mailing list](https://groups.google.com/forum/?fromgroups=#!topic/derbyjs/oLr2xlFjGcQ))

## Performance improvements
 - refLists will not build their entire result arrays when accessing an item on a ref to a refList (see [#114](https://github.com/codeparty/racer/issues/114))  

 - Don't re-run filters when creating a query that already exists  (see [#78](https://github.com/codeparty/racer/issues/78))  


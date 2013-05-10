{expect} = require '../util'
{BrowserModel: Model} = require '../util/model'
sinon = require 'sinon'

describe 'In browser filters', ->
  beforeEach ->
    Model::allowWritesOnAbsentDoc = true
  afterEach ->
    delete Model::allowWritesOnAbsentDoc
  describe 'Model#filter', ->
    describe 'among documents under a top-level namespace', ->
      describe 'filter by both function and query methods', ->
        it 'should return a scoped model with access to results', ->
          model =  new Model

          model.set 'users.1', id: '1', age: 20
          model.set 'users.2', userTwo = id: '2', age: 30
          model.set 'users.3', id: '3', age: 40

          computation = model.at('users').filter
            where:
              age: {gt: 20}
          computation = computation.filter (user) ->
            user.age < 40
          results = model.ref '_results', computation
          expect(results.get()).to.eql [userTwo]
          expect(model.get('_results')).to.eql [userTwo]

      describe 'without sort descriptors (change this later to return unordered results)', ->
        it 'should return a scoped model with access to results', ->
          model =  new Model

          model.set 'users.1', id: '1', age: 20
          model.set 'users.2', userTwo = id: '2', age: 30

          computation = model.at('users').filter
            where:
              age: {gte: 30}
          results = model.ref '_results', computation
          expect(results.get()).to.eql [userTwo]
          expect(model.get('_results')).to.eql [userTwo]

        describe 'in response to local mutations that add to the results', ->
          describe 'when the mutation is expressed with the filter', ->
            it 'should emit mutation events on the dependency document', (done) ->
              model = new Model
              model.set 'tasks',
                a:
                  id: 'a'
                b:
                  id: 'b'
              model.ref '_filtered', model.filter('tasks').where('completed').exists(false)
              model.on 'set', 'tasks.*.completed', (id, val, oldVal) ->
                expect(val).to.equal true
                done()
              model.set '_filtered.0.completed', true

            it 'should emit mutation events on the dependency document, when the filter has an extra ref of indirection', (done) ->
              model = new Model
              model.set 'tasks',
                a:
                  id: 'a'
                b:
                  id: 'b'
              model.ref '_filtered', model.filter('tasks').where('completed').exists(false)
              model.on 'set', 'tasks.*.completed', (id, val, oldVal) ->
                expect(val).to.equal true
                done()
              model.ref '_a', '_filtered'
              model.set '_a.0.completed', true

          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'users.1', id: '1', age: 20
            model.set 'users.2', userTwo = id: '2', age: 30

            results = model.ref '_results', model.filter 'users',
              where:
                age: {gte: 30}
            expect(results.get()).to.eql [userTwo]
            model.set 'users.1.age', 31
            expect(results.get()).to.specEql [userTwo, {id: '1', age: 31}]
            model.set 'users.2.age', 19
            expect(results.get()).to.specEql [{id: '1', age: 31}]

          it 'should return a scoped model whose results update correctly when the parent object is replaced', ->
            model =  new Model

            model.set 'rooms.home', 
              arr: arr = [
                {id:'1', s: '1'}
                {id:'2', s: '2'}
                {id:'3', s: '3'}
                {id:'4', s: '4'}
                {id:'5', s: '5'}
              ]

            results = model.ref '_results', model.filter 'rooms.home.arr',
              limit: 50

            expect(results.get()).to.eql arr

            model.set 'rooms.home', 
              arr: [
                {id:'1', s: '1'}
                {id:'2', s: '2'}
                {id:'3', s: '3'}
                {id:'4', s: '4'}
                {id:'5', s: '5'}
              ]
            expect(results.get()).to.eql arr

            model.set 'rooms.home', 
              arr: biggerArr = [
                {id:'1', s: '1'}
                {id:'2', s: '2'}
                {id:'3', s: '3'}
                {id:'4', s: '4'}
                {id:'5', s: '5'}
                {id:'6', s: '6'}
              ]
            expect(results.get()).to.eql biggerArr

          it 'a custom filter should remain updated', ->
            model =  new Model

            model.set 'users.1', id: '1', age: 20
            model.set 'users.2', userTwo = id: '2', age: 30

            results = model.ref '_results', model.filter 'users', (user) ->
              return user.age >= 30
            expect(results.get()).to.eql [userTwo]
            model.set 'users.1.age', 31
            expect(results.get()).to.specEql [userTwo, {id: '1', age: 31}]
            model.set 'users.2.age', 19
            expect(results.get()).to.specEql [{id: '1', age: 31}]

          it 'should emit mutation events on the results ref', (done) ->
            model =  new Model

            model.set 'users.1', id: '1', age: 20
            model.set 'users.2', userTwo = id: '2', age: 30

            results = model.ref '_results', model.filter 'users',
              where:
                age: {gte: 30}
            expect(results.get()).to.eql [userTwo]

            model.on 'insert', results.path(), (at, document, out, isLocal) ->
              expect(at).to.equal 1
              expect(document).to.specEql {id: '1', age: 31}
              done()

            model.set 'users.1.age', 31

        describe 'in response to local mutations that remove a result', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'users.1', userOne = id: '1', age: 30
            model.set 'users.2', userTwo = id: '2', age: 31

            computation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [userOne, userTwo]
            model.set 'users.1.age', 29
            expect(results.get()).to.specEql [userTwo]

          it 'should emit remove events on the results refList', (done) ->
            model =  new Model

            model.set 'users.1', userOne = id: '1', age: 30
            model.set 'users.2', userTwo = id: '2', age: 31

            computation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [userOne, userTwo]

            model.on 'remove', results.path(), (start, howMany, out, isLocal, pass) ->
              expect(start).to.equal 0
              expect(howMany).to.equal 1
              done()

            model.set 'users.1.age', 29

        describe 'in response to local mutations that re-order the results', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'users.1', userOne = id: '1', age: 30
            model.set 'users.2', userTwo = id: '2', age: 31

            computation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [userOne, userTwo]
            model.set 'users.1.age', 32
            expect(results.get()).to.specEql [userTwo, {id: '1', age: 32}]

          it 'should emit move events on the results refList', (done) ->
            model =  new Model

            model.set 'users.1', userOne = id: '1', age: 30
            model.set 'users.2', userTwo = id: '2', age: 31

            computation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [userOne, userTwo]

            model.on 'move', results.path(), (from, to, howMany, out, isLocal) ->
              expect(from).to.equal 0
              expect(to).to.equal 1
              expect(howMany).to.equal 1
              done()

            model.set 'users.1.age', 32

      it 'should self-destruct on cleanup if not referenced', ->
        model = new Model
        computation1 = model.at('users').filter
          where:
            age: {gt: 20}
        computation2 = computation1.filter (user) -> user.age < 40
        expect(computation1.get()).to.eql []
        expect(computation2.get()).to.eql []

        model.emit 'cleanup', true
        expect(computation1.get()).to.equal undefined
        expect(computation2.get()).to.equal undefined

      it 'should not self-destruct on cleanup if referenced', ->
        model = new Model
        model.set 'users.0', user = id: '0', age: 30
        model.set 'users.1', id: '1', age: 20
        computation1 = model.at('users').filter
          where:
            age: {gt: 20}
        computation2 = model.filter(computation1).where(age: {lt: 40}).count()
        expect(computation1.get()).to.eql [user]
        expect(computation2.get()).to.equal 1

        model.ref '_query', computation2
        expect(model.get('_query')).to.equal 1

        model.emit 'cleanup', true
        expect(computation1.get()).to.eql [user]
        expect(computation2.get()).to.equal 1

#      describe 'with sort descriptors', ->
#        # TODO Add all similar tests from "without sort descriptors"
#        it 'should return a scoped model with access to results', ->
#          model =  new Model
#
#          model.set 'users.1', id: '1', age: 20
#          model.set 'users.2', userTwo = id: '2', age: 30
#
#          results = model.filter '_results', 'users',
#            where:
#              age: {gte: 30}
#          expect(results.get()).to.eql [userTwo]
#          expect(model.get('_results')).to.eql [userTwo]
#
#        describe 'in response to local mutations that add to the results', ->
#          it 'should emit insert events on the results refList', (done) ->
#            model =  new Model
#
#            model.set 'users.1', id: '1', age: 20
#            model.set 'users.2', userTwo = id: '2', age: 30
#
#            results = model.filter '_results', 'users',
#              where:
#                age: {gte: 30}
#            expect(results.get()).to.eql [userTwo]
#
#            model.on 'insert', results.path(), (index, document, out, isLocal) ->
#              expect(index).to.equal 1
#              expect(document).to.specEql {id: '1', age: 31}
#              done()
#
#            model.set 'users.1.age', 31
#
#        # TODO

    describe 'among documents under a nested path', ->
      describe 'organized in an Object', ->
        it 'should return a scoped model with access to results', ->
          model =  new Model

          model.set 'a.b.c.A', id: 'A', age: 20
          model.set 'a.b.c.B', docB = id: 'B', age: 30

          computation = model.filter('a.b.c').where('age').gte(30)
          results = model.ref '_results', computation
          expect(results.get()).to.eql [docB]

        describe 'in response to local mutations that add to the results', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'a.b.c.A', id: 'A', age: 20
            model.set 'a.b.c.B', docB = id: 'B', age: 30

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docB]
            model.set 'a.b.c.A.age', 31
            expect(results.get()).to.specEql [docB, {id: 'A', age: 31}]

          it 'should emit insert events on the results refList', (done) ->
            model =  new Model

            model.set 'a.b.c.A', id: 'A', age: 20
            model.set 'a.b.c.B', docB = id: 'B', age: 30

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docB]

            model.on 'insert', results.path(), (index, document, out, isLocal) ->
              expect(index).to.equal 1
              expect(document).to.specEql {id: 'A', age: 31}
              done()

            model.set 'a.b.c.A.age', 31

        describe 'in response to local mutations that remove a result', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'a.b.c.A', docA = id: 'A', age: 30
            model.set 'a.b.c.B', docB = id: 'B', age: 31

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]
            model.set 'a.b.c.A.age', 29
            expect(results.get()).to.eql [docB]

          it 'should emit remove events on the results refList', (done) ->
            model =  new Model

            model.set 'a.b.c.A', docA = id: 'A', age: 30
            model.set 'a.b.c.B', docB = id: 'B', age: 31

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]

            model.on 'remove', results.path(), (start, howMany, out, isLocal, pass) ->
              expect(start).to.equal 0
              expect(howMany).to.equal 1
              done()

            model.set 'a.b.c.A.age', 29

        describe 'in response to local mutations that re-order the results', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'a.b.c.A', docA = id: 'A', age: 30
            model.set 'a.b.c.B', docB = id: 'B', age: 31

            computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]
            model.set 'a.b.c.A.age', 32
            expect(results.get()).to.specEql [docB, {id: 'A', age: 32}]

          it 'should emit move events on the results refList', (done) ->
            model =  new Model

            model.set 'a.b.c.A', docA = id: 'A', age: 30
            model.set 'a.b.c.B', docB = id: 'B', age: 31

            computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]

            model.on 'move', results.path(), (from, to, howMany, out, isLocal, pass) ->
              expect(from).to.equal 0
              expect(to).to.equal 1
              expect(howMany).to.equal 1
              done()

            model.set 'a.b.c.A.age', 32

      describe 'organized in an Array', ->
        it 'should return a scoped model with access to results', ->
          model =  new Model

          model.set 'a.b.c', [
            { id: 'A', age: 20 }
          , docB = { id: 'B', age: 30 }
          ]

          computation = model.filter('a.b.c').where('age').gte(30)
          results = model.ref '_results', computation
          expect(results.get()).to.eql [docB]

        describe 'in response to local mutations that add to the results', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'a.b.c', [
              { id: 'A', age: 20 }
            , docB = { id: 'B', age: 30 }
            ]

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docB]
            model.set 'a.b.c.0.age', 31
            expect(results.get()).to.specEql [docB, {id: 'A', age: 31}]

          it 'should emit insert events on the results refList', (done) ->
            model =  new Model

            model.set 'a.b.c', [
              { id: 'A', age: 20 }
            , docB = { id: 'B', age: 30 }
            ]

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docB]

            model.on 'insert', results.path(), (index, document, out, isLocal) ->
              expect(index).to.equal 1
              expect(document).to.specEql {id: 'A', age: 31}
              done()

            model.set 'a.b.c.0.age', 31

        describe 'in response to local mutations that remove a result', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'a.b.c', [
              docA = { id: 'A', age: 30 }
            , docB = { id: 'B', age: 31 }
            ]

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]
            model.set 'a.b.c.0.age', 29
            expect(results.get()).to.specEql [docB]

          it 'should emit remove events on the results refList', (done) ->
            model =  new Model

            model.set 'a.b.c', [
              docA = { id: 'A', age: 30 }
            , docB = { id: 'B', age: 31 }
            ]

            computation = model.filter('a.b.c').where('age').gte(30)
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]

            model.on 'remove', results.path(), (start, howMany, out, isLocal, pass) ->
              expect(start).to.equal 0
              expect(howMany).to.equal 1
              done()

            model.set 'a.b.c.0.age', 29

        describe 'in response to local mutations that remove the underlying document originally in a filter of a filter', ->
          it 'should return a scoped model whose results update automatically, without console.warning', ->
            model =  new Model

            model.set 'collection.a', docA = {id: 'a', age: 30}
            model.set 'collection.b', docB = {id: 'b', age: 31}

            warn = console.warn
            console.warn = warnSpy = sinon.spy()

            computation = model.filter('collection').where('age').gte(20).sort(['age', 'asc'])
            $results = model.ref '_results', computation
            expect($results.get()).to.eql [docA, docB]
            $compoundResults = model.ref '_compoundResults', $results.filter().where('age').gte(29).sort(['age', 'asc'])
            model.del 'collection.b'
            expect($compoundResults.get()).to.specEql [docA]

            console.warn = warn

            expect(warnSpy).to.have.callCount(0)


        describe 'in response to local mutations that re-order the results', ->
          it 'should return a scoped model whose results update automatically', ->
            model =  new Model

            model.set 'a.b.c', [
              docA = { id: 'A', age: 30 }
            , docB = { id: 'B', age: 31 }
            ]

            computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]
            model.set 'a.b.c.0.age', 32
            expect(results.get()).to.specEql [docB, {id: 'A', age: 32}]

          it 'should emit move events on the results refList', (done) ->
            model =  new Model

            model.set 'a.b.c', [
              docA = { id: 'A', age: 30 }
            , docB = { id: 'B', age: 31 }
            ]

            computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc'])
            results = model.ref '_results', computation
            expect(results.get()).to.eql [docA, docB]

            model.on 'move', results.path(), (from, to, howMany, out, isLocal) ->
              expect(from).to.equal 0
              expect(to).to.equal 1
              expect(howMany).to.equal 1
              done()

            model.set 'a.b.c.0.age', 32

        describe 'in response to mutations on the filter results updating results', ->
          it 'should update the results', ->
            model = new Model
            model.set 'a.b.c', [
              docA = {id: 'A', age: 30}
            , docB = {id: 'B', age: 31}
            ]
            computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc'])
            $results = model.ref '_results', computation
            $results.incr '0.age', -1
            expect($results.get()).to.eql [docB]

    describe 'among another filter results', ->
      it 'should return a scoped model with access to results', ->
        model =  new Model

        model.set 'users.1', userOne = id: '1', age: 30
        model.set 'users.2', userTwo = id: '2', age: 31

        baseComputation = model.filter('users').where('age').gte(30)
        baseResults = model.ref '_baseResults', baseComputation
        expect(baseResults.get()).to.eql [userOne, userTwo]

        computation = model.filter(baseResults).where('age').gte(31)
        results = model.ref '_results', computation
        expect(results.get()).to.eql [userTwo]

      describe 'in response to local mutations that add to the results', ->
        it 'should return a scoped model whose results update automatically', ->
          model =  new Model

          model.set 'users.1', userOne = id: '1', age: 30
          model.set 'users.2', userTwo = id: '2', age: 31

          baseComputation = model.filter('users').where('age').gte(30)
          baseResults = model.ref '_baseResults', baseComputation
          expect(baseResults.get()).to.eql [userOne, userTwo]

          computation = model.filter(baseResults).where('age').gte(31)
          results = model.ref '_results', computation
          expect(results.get()).to.eql [userTwo]

          model.set 'users.3', userThree = {id: '3', age: 32}
          expect(results.get()).to.eql [userTwo, userThree]

        # Tests transitivity of events across queries over query results
        it 'should emit insert events on the results refList', (done) ->
          model =  new Model

          model.set 'users.1', userOne = id: '1', age: 30
          model.set 'users.2', userTwo = id: '2', age: 31

          baseComputation = model.filter('users').where('age').gte(30)
          baseResults = model.ref '_baseResults', baseComputation
          expect(baseResults.get()).to.eql [userOne, userTwo]

          computation = model.filter(baseResults).where('age').gte(31)
          results = model.ref '_results', computation
          expect(results.get()).to.eql [userTwo]

          model.on 'insert', results.path(), (index, document, out, isLocal) ->
            expect(index).to.equal 1
            expect(document).to.specEql { id: '3', age: 32 }
            done()

          model.set 'users.3', userThree = {id: '3', age: 32}

        describe 'when first filter results are an array', ->
          it 'should return a scoped model whose results update automatically', (done) ->
            model =  new Model

            model.set 'users.x', id: 'x', age: 30
            model.set 'users.y', id: 'y', age: 31

            baseComputation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
            baseResults = model.ref '_baseResults', baseComputation

            computation = model.filter(baseResults).where('age').gte(31).sort(['age', 'asc'])
            results = model.ref '_results', computation

            model.on 'set', '_results.*.age', (index, age) ->
              expect(age).to.equal 32
              done()

            model.set 'users.y.age', 32

      describe 'in response to local mutations that remove a result', ->
        it 'should return a scoped model whose results update automatically', ->
          model =  new Model

          model.set 'users.1', userOne = id: '1', age: 31
          model.set 'users.2', userTwo = id: '2', age: 32

          baseComputation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
          baseResults = model.ref '_baseResults', baseComputation
          expect(baseResults.get()).to.eql [userOne, userTwo]

          computation = model.filter(baseResults).where('age').gte(31)
          results = model.ref '_results', computation
          expect(results.get()).to.eql [userOne, userTwo]

          model.set 'users.2.age', 30
          expect(baseResults.get()).to.specEql [{id: '2', age: 30}, userOne]
          expect(results.get()).to.eql [userOne]

        it 'should emit remove events on the results refList', (done) ->
          model =  new Model

          model.set 'users.1', userOne = id: '1', age: 31
          model.set 'users.2', userTwo = id: '2', age: 32

          baseComputation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
          baseResults = model.ref '_baseResults', baseComputation

          computation = model.filter(baseResults).where('age').gte(31)
          results = model.ref '_results', computation

          model.on 'remove', results.path(), (start, howMany, out, isLocal, pass) ->
            expect(start).to.equal 1
            expect(howMany).to.equal 1
            done()

          model.set 'users.2.age', 30

      describe 'in response to local mutations that re-order the results', ->
        it 'should return a scoped model whose results update automatically', ->
          model =  new Model

          model.set 'users.1', userOne = id: '1', age: 32
          model.set 'users.2', userTwo = id: '2', age: 33

          baseComputation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
          baseResults = model.ref '_baseResults', baseComputation
          expect(baseResults.get()).to.eql [userOne, userTwo]

          computation = model.filter(baseResults).where('age').gte(31).sort(['age', 'desc'])
          results = model.ref '_results', computation
          expect(results.get()).to.eql [userTwo, userOne]

          model.set 'users.2.age', 31
          expect(baseResults.get()).to.specEql [{id: '2', age: 31}, userOne]
          expect(results.get()).to.specEql [userOne, {id: '2', age: 31}]

        it 'should emit move events on the results refList', (done) ->
          model =  new Model

          model.set 'users.1', userOne = id: '1', age: 32
          model.set 'users.2', userTwo = id: '2', age: 33

          baseComputation = model.filter('users').where('age').gte(30).sort(['age', 'asc'])
          baseResults = model.ref '_baseResults', baseComputation

          computation = model.filter(baseResults).where('age').gte(31).sort(['age', 'desc'])
          results = model.ref '_results', computation

          model.on 'move', results.path(), (from, to, howMany, out, isLocal) ->
            expect(from).to.equal 0
            expect(to).to.equal 1
            expect(howMany).to.equal 1
            done()

          model.set 'users.2.age', 31

  describe 'one()', ->
    describe 'among documents under a top-level namespace', ->
      it 'should return a scoped model with access to the result', ->
        model = new Model

        model.set 'users.1', userOne = id: '1', age: 21
        model.set 'users.2', id: '2', age: 22

        computation = model.filter('users').where('age').gte(21).one()
        result = model.ref '_result', computation
        expect(result.get()).to.eql userOne

      # TODO Add more edge case testing to this describe
      describe 'in response to local mutations that would add results for an equiv find query', ->
        it 'should return a scoped model whose result updates automatically', ->
          model = new Model

          model.set 'users.1', userOne = id: '1', age: 31
          model.set 'users.2', id: '2', age: 21

          computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql userOne
          model.set 'users.2.age', 30
          expect(result.get()).to.specEql {id: '2', age: 30 }

        it 'should emit set events on the result ref', (done) ->
          model = new Model

          model.set 'users.1', userOne = id: '1', age: 31
          model.set 'users.2', id: '2', age: 21

          computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql userOne

          model.on 'set', result.path(), (document, isLocal) ->
            expect(document).to.specEql {id: '2', age: 30}
            done()

          model.set 'users.2.age', 30

      describe 'in response to local mutations that would remove a result from an equiv find query', ->
        describe 'equivalent to the one().find result', ->
          describe 'when the find query would have > 1 result', ->
            it 'should return a scoped model whose result updates automatically', ->
              model =  new Model

              model.set 'users.1', userOne = id: '1', age: 30
              model.set 'users.2', userTwo = id: '2', age: 31

              computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
              result = model.ref '_result', computation
              expect(result.get()).to.eql userOne
              model.set 'users.1.age', 29
              expect(result.get()).to.specEql userTwo

            it 'should emit set events on the result ref', (done) ->
              model =  new Model

              model.set 'users.1', userOne = id: '1', age: 30
              model.set 'users.2', userTwo = id: '2', age: 31

              computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
              result = model.ref '_result', computation

              model.on 'set', result.path(), (document, out, isLocal, pass) ->
                expect(document).to.eql userTwo
                done()
              model.set 'users.1.age', 29

          describe 'when the find query would have only 1 result', ->
            it 'should return a scoped model whose result updates automatically', ->
              model =  new Model

              model.set 'users.1', userOne = id: '1', age: 30

              computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
              result = model.ref '_result', computation
              expect(result.get()).to.eql userOne
              model.set 'users.1.age', 29
              expect(result.get()).to.eql undefined

            it 'should emit set events on the result ref', (done) ->
              model =  new Model

              model.set 'users.1', userOne = id: '1', age: 30

              computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
              result = model.ref '_result', computation

              model.on 'set', result.path(), (document, out, isLocal, pass) ->
                expect(document).to.eql undefined
                done()
              model.set 'users.1.age', 29

        describe 'occurring after the first find result', ->
          it 'should return a scoped model whose result appropriately does not react', ->
            model =  new Model

            model.set 'users.1', userOne = id: '1', age: 30
            model.set 'users.2', userTwo = id: '2', age: 31

            computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
            result = model.ref '_result', computation
            expect(result.get()).to.eql userOne
            model.set 'users.2.age', 29
            expect(result.get()).to.specEql userOne

          it 'should not emit set events on the result ref', ->
            model =  new Model

            model.set 'users.1', userOne = id: '1', age: 30
            model.set 'users.2', userTwo = id: '2', age: 31

            computation = model.filter('users').where('age').gte(30).sort(['age', 'asc']).one()
            result = model.ref '_result', computation

            callback = sinon.spy()

            model.on 'set', result.path(), callback
            model.set 'users.2.age', 29
            expect(callback).to.have.callCount(0)

    # TODO Cover more edge cases from here on
    describe 'among documents under a nested path', ->
      describe 'organized in an Object', ->
        it 'should return a scoped model with access to result', ->
          model = new Model

          model.set 'a.b.c.A', docA = id: 'A', age: 21
          model.set 'a.b.c.B', id: 'B', age: 22

          computation = model.filter('a.b.c').where('age').gte(21).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql docA

        it 'should return a scoped model whose result is updated automatically in response to local mutations', ->
          model = new Model

          model.set 'a.b.c.A', docA = id: 'A', age: 31
          model.set 'a.b.c.B', id: 'B', age: 21

          computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql docA
          model.set 'a.b.c.B.age', 30
          expect(result.get()).to.specEql {id: 'B', age: 30 }

        it 'should emit insert events on the result ref in response to relevant local mutations', (done) ->
          model = new Model

          model.set 'a.b.c.A', docA = id: 'A', age: 31
          model.set 'a.b.c.B', id: 'B', age: 21

          computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql docA

          model.on 'set', result.path(), (document, isLocal) ->
            expect(document).to.specEql {id: 'B', age: 30}
            done()

          model.set 'a.b.c.B.age', 30

      describe 'organized in an Array', ->
        it 'should return a scoped model with access to result', ->
          model = new Model

          model.set 'a.b.c', [
            docA = {id: 'A', age: 21}
            {id: 'B', age: 22}
          ]

          computation = model.filter('a.b.c').where('age').gte(21).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql docA

        it 'should return a scoped model whose result is updated automatically in response to local mutations', ->
          model = new Model

          model.set 'a.b.c', [
            docA = {id: 'A', age: 31}
            {id: 'B', age: 22}
          ]

          computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql docA
          model.set 'a.b.c.1.age', 30
          expect(result.get()).to.specEql {id: 'B', age: 30 }

        it 'should emit insert events on the results refList in response to relevant local mutations', (done) ->
          model = new Model

          model.set 'a.b.c', [
            docA = {id: 'A', age: 31}
            {id: 'B', age: 22}
          ]

          computation = model.filter('a.b.c').where('age').gte(30).sort(['age', 'asc']).one()
          result = model.ref '_result', computation
          expect(result.get()).to.eql docA

          model.on 'set', result.path(), (document, isLocal) ->
            expect(document).to.specEql {id: 'B', age: 30}
            done()

          model.set 'a.b.c.1.age', 30

        it 'should not include a new doc that does not match if a filter().one()', ->
          model = new Model
          model.set 'collection.a', docA = {id: 'a', age: 30}
          model.set 'collection.b', {id: 'b', age: 31}
          $results = model.ref '_result', model.filter('collection').where('age').gte(40).sort(['age', 'asc'])
          expect($results.get()).to.eql([])
          $compoundResult = model.ref '_compoundResult', $results.filter().where('age').gte(50).sort(['age', 'asc']).one()
          expect($compoundResult.get()).to.eql(undefined)
          model.set 'collection.a.age', 40
          expect($compoundResult.get()).to.eql undefined

        it 'should react to the domain being set, without console.warning', ->
          model = new Model
          $result = model.ref '_result', model.filter('a.b.c').where('age').gte(40).sort(['age', 'asc']).one()
          expect($result.get()).to.eql(undefined)
          warn = console.warn
          console.warn = warnSpy = sinon.spy()
          model.set 'a.b.c', []
          console.warn = warn
          expect(warnSpy).to.have.callCount(0)

    describe 'among search results', ->
      it 'should return a scoped model with access to result', ->
        model =  new Model

        model.set 'users.1', userOne = id: '1', age: 30
        model.set 'users.2', userTwo = id: '2', age: 31

        baseComputation = model.filter('users').where('age').gte(30)
        baseResults = model.ref '_baseResults', baseComputation
        expect(baseResults.get()).to.eql [userOne, userTwo]

        computation = model.filter(baseResults).where('age').gte(31).sort(['age', 'asc']).one()
        result = model.ref '_result', computation
        expect(result.get()).to.eql userTwo

      it 'should return a scoped model whose result is updated automatically in response to local mutations', ->
        model =  new Model

        model.set 'users.1', userOne = id: '1', age: 30
        model.set 'users.2', userTwo = id: '2', age: 32

        baseComputation = model.filter('users').where('age').gte(30)
        baseResults = model.ref '_baseResults', baseComputation
        expect(baseResults.get()).to.eql [userOne, userTwo]

        computation = model.filter(baseResults).where('age').gte(31).sort(['age', 'asc']).one()
        result = model.ref '_result', computation
        expect(result.get()).to.eql userTwo

        model.set 'users.3', userThree = {id: '3', age: 31}
        expect(result.get()).to.eql userThree

      # Tests transitivity of events across queries over query results
      it 'should emit insert events on the results refList in response to relevant local mutations', (done) ->
        model =  new Model

        model.set 'users.1', userOne = id: '1', age: 30
        model.set 'users.2', userTwo = id: '2', age: 32

        baseComputation = model.filter('users').where('age').gte(30)
        baseResults = model.ref '_baseResults', baseComputation
        expect(baseResults.get()).to.eql [userOne, userTwo]

        computation = model.filter(baseResults).where('age').gte(31).sort(['age', 'asc']).one()
        result = model.ref '_result', computation
        expect(result.get()).to.eql userTwo

        model.on 'set', result.path(), (document, isLocal) ->
          expect(document).to.specEql { id: '3', age: 31 }
          done()

        model.set 'users.3', userThree = {id: '3', age: 31}

# TODO Add test to throw error if you forget to specify a sort on one().find
# TODO Test registerQuery, unregisterQuery, and locateQuery
# TODO Test Model#query
# TODO Test Model#one().find
# TODO Test Model#find
# TODO Test Model#fetch

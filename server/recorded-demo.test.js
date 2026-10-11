import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenPath, flightToTemplate } from './recorded-demo.js'

test('parses GeoJSON LineString coordinates into replay points', () => {
  const points = flattenPath({
    path: {
      type: 'LineString',
      coordinates: [
        [2.55, 49.01, 1200],
        [2.60, 49.05, 3500],
        [2.70, 49.12, 9000],
      ],
    },
  })

  assert.equal(points.length, 3)
  assert.deepEqual(points[0], {
    longitude: 2.55,
    latitude: 49.01,
    altitudeFt: 1200,
  })
  assert.equal(points[2].altitudeFt, 9000)
})

test('supports nested route segments and removes duplicate consecutive positions', () => {
  const points = flattenPath({
    path: {
      type: 'MultiLineString',
      coordinates: [
        [[10, 20, 100], [11, 21, 200]],
        [[11, 21, 200], [12, 22, 300]],
      ],
    },
  })

  assert.equal(points.length, 3)
  assert.deepEqual(points.map(({ longitude, latitude }) => [longitude, latitude]), [
    [10, 20],
    [11, 21],
    [12, 22],
  ])
})

test('normalizes an archived flight into a replay template', () => {
  const template = flightToTemplate({
    flight_id: 'abc123:2026-10-01T10:00:00Z',
    icao24: 'abc123',
    callsign: 'BAW123',
    registration: 'G-EUOF',
    icao_type: 'A319',
    model: 'AIRBUS A-319',
    operator: 'British Airways',
    start_ts: '2026-10-01T10:00:00Z',
    end_ts: '2026-10-01T11:00:00Z',
    path: {
      type: 'LineString',
      coordinates: [
        [0, 51, 1000],
        [1, 52, 5000],
        [2, 53, 10000],
        [3, 54, 15000],
        [4, 55, 20000],
      ],
    },
    path_gs: [[[1790848800, 220], [1790850000, 300]]],
    path_tracks: [[[1790848800, 90], [1790850000, 95]]],
    path_vr: [[[1790848800, 1200]]],
    squawk_runs: [[[1790848800, '1234']]],
  })

  assert.ok(template)
  assert.equal(template.icao24, 'abc123')
  assert.equal(template.callsign, 'BAW123')
  assert.equal(template.registration, 'G-EUOF')
  assert.equal(template.aircraftType, 'A319')
  assert.equal(template.airline, 'British Airways')
  assert.equal(template.path.length, 5)
  assert.deepEqual(template.groundSpeed, [220, 300])
  assert.deepEqual(template.trackHeadings, [90, 95])
  assert.deepEqual(template.verticalRates, [1200])
  assert.equal(template.squawk, '1234')
})

test('rejects incomplete or unidentified flight paths', () => {
  assert.equal(flattenPath({ path: { coordinates: null } }).length, 0)
  assert.equal(flightToTemplate({
    icao24: 'bad',
    callsign: 'TEST1',
    path: { type: 'LineString', coordinates: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
  }), null)
})

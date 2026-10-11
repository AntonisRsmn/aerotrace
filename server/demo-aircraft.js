const AIRPORTS = [
  ['KATL','ATL','Atlanta','United States',33.6407,-84.4277],
  ['KJFK','JFK','New York','United States',40.6413,-73.7781],
  ['KLAX','LAX','Los Angeles','United States',33.9416,-118.4085],
  ['KORD','ORD','Chicago','United States',41.9742,-87.9073],
  ['KSFO','SFO','San Francisco','United States',37.6213,-122.3790],
  ['KMIA','MIA','Miami','United States',25.7959,-80.2870],
  ['CYYZ','YYZ','Toronto','Canada',43.6777,-79.6248],
  ['MMMX','MEX','Mexico City','Mexico',19.4361,-99.0719],
  ['EGLL','LHR','London','United Kingdom',51.4700,-0.4543],
  ['LFPG','CDG','Paris','France',49.0097,2.5479],
  ['EDDF','FRA','Frankfurt','Germany',50.0379,8.5622],
  ['EHAM','AMS','Amsterdam','Netherlands',52.3105,4.7683],
  ['LEMD','MAD','Madrid','Spain',40.4983,-3.5676],
  ['LGAV','ATH','Athens','Greece',37.9364,23.9445],
  ['LIRF','FCO','Rome','Italy',41.8003,12.2389],
  ['LTFM','IST','Istanbul','Türkiye',41.2753,28.7519],
  ['OMDB','DXB','Dubai','United Arab Emirates',25.2532,55.3657],
  ['OERK','RUH','Riyadh','Saudi Arabia',24.9576,46.6988],
  ['VIDP','DEL','Delhi','India',28.5562,77.1000],
  ['VABB','BOM','Mumbai','India',19.0896,72.8656],
  ['WSSS','SIN','Singapore','Singapore',1.3644,103.9915],
  ['VTBS','BKK','Bangkok','Thailand',13.6900,100.7501],
  ['RJTT','HND','Tokyo','Japan',35.5494,139.7798],
  ['ZBAA','PEK','Beijing','China',40.0799,116.6031],
  ['VHHH','HKG','Hong Kong','Hong Kong',22.3080,113.9185],
  ['YSSY','SYD','Sydney','Australia',-33.9399,151.1753],
  ['YMML','MEL','Melbourne','Australia',-37.6690,144.8410],
  ['FAOR','JNB','Johannesburg','South Africa',-26.1367,28.2411],
  ['FACT','CPT','Cape Town','South Africa',-33.9700,18.5972],
  ['SBGR','GRU','São Paulo','Brazil',-23.4356,-46.4731],
  ['SCEL','SCL','Santiago','Chile',-33.3930,-70.7858],
  ['SAEZ','EZE','Buenos Aires','Argentina',-34.8222,-58.5358],
  ['SKBO','BOG','Bogotá','Colombia',4.7016,-74.1469],
].map(([icao,iata,name,country,lat,lon]) => ({icao,iata,name,country,lat,lon}))

// Real-world airline ICAO designators and names are used to make demo
// callsigns look authentic. Flight numbers and positions remain simulated.
const AIRLINES = [
  ['AEE', 'Aegean Airlines'],
  ['BAW', 'British Airways'],
  ['DLH', 'Lufthansa'],
  ['AFR', 'Air France'],
  ['KLM', 'KLM Royal Dutch Airlines'],
  ['UAE', 'Emirates'],
  ['QTR', 'Qatar Airways'],
  ['THY', 'Turkish Airlines'],
  ['AAL', 'American Airlines'],
  ['UAL', 'United Airlines'],
  ['DAL', 'Delta Air Lines'],
  ['SWR', 'Swiss International Air Lines'],
  ['RYR', 'Ryanair'],
  ['EZY', 'easyJet'],
  ['SAS', 'Scandinavian Airlines'],
  ['QFA', 'Qantas'],
  ['SIA', 'Singapore Airlines'],
  ['CPA', 'Cathay Pacific'],
  ['ANA', 'All Nippon Airways'],
  ['JAL', 'Japan Airlines'],
  ['CCA', 'Air China'],
  ['CSN', 'China Southern Airlines'],
  ['ETH', 'Ethiopian Airlines'],
  ['ACA', 'Air Canada'],
  ['IBE', 'Iberia'],
  ['TAP', 'TAP Air Portugal'],
]
const TYPES = [
  ['A320','Airbus A320','Passenger',3,390,455],
  ['A20N','Airbus A320neo','Passenger',3,395,460],
  ['A321','Airbus A321','Passenger',3,400,465],
  ['B738','Boeing 737-800','Passenger',3,390,455],
  ['B38M','Boeing 737 MAX 8','Passenger',3,395,460],
  ['E190','Embraer 190','Passenger',2,360,425],
  ['A359','Airbus A350-900','Passenger',4,450,510],
  ['B789','Boeing 787-9','Passenger',4,450,510],
  ['B77W','Boeing 777-300ER','Passenger',4,450,510],
  ['A388','Airbus A380-800','Passenger',5,450,510],
  ['B744','Boeing 747-400F','Cargo',5,430,490],
  ['B77L','Boeing 777F','Cargo',5,440,500],
  ['C172','Cessna 172','General aviation',11,85,125],
  ['PC12','Pilatus PC-12','Business',2,210,275],
  ['H145','Airbus H145','Helicopter',7,100,145],
]

function seededRandom(seed) {
  let value = (seed >>> 0) || 1
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}
function radians(degrees) { return degrees * Math.PI / 180 }
function degrees(radiansValue) { return radiansValue * 180 / Math.PI }
function distanceKm(a, b) {
  const p1 = radians(a.lat), p2 = radians(b.lat)
  const dp = p2 - p1, dl = radians(b.lon - a.lon)
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}
function interpolate(a, b, progress) {
  const lat1 = radians(a.lat), lon1 = radians(a.lon)
  const lat2 = radians(b.lat), lon2 = radians(b.lon)
  const va = [Math.cos(lat1)*Math.cos(lon1), Math.cos(lat1)*Math.sin(lon1), Math.sin(lat1)]
  const vb = [Math.cos(lat2)*Math.cos(lon2), Math.cos(lat2)*Math.sin(lon2), Math.sin(lat2)]
  const dot = Math.max(-1, Math.min(1, va[0]*vb[0] + va[1]*vb[1] + va[2]*vb[2]))
  const omega = Math.acos(dot)
  if (omega < 1e-6) return {lat:a.lat, lon:a.lon}
  const scaleA = Math.sin((1-progress)*omega) / Math.sin(omega)
  const scaleB = Math.sin(progress*omega) / Math.sin(omega)
  const x = scaleA*va[0] + scaleB*vb[0]
  const y = scaleA*va[1] + scaleB*vb[1]
  const z = scaleA*va[2] + scaleB*vb[2]
  return {lat:degrees(Math.atan2(z, Math.sqrt(x*x+y*y))), lon:((degrees(Math.atan2(y,x))+540)%360)-180}
}
function createRouteCoordinates(origin, destination, segments = 64) {
  const coordinates = []
  for (let index = 0; index <= segments; index += 1) {
    const point = interpolate(origin, destination, index / segments)
    coordinates.push([
      Number(point.lon.toFixed(5)),
      Number(point.lat.toFixed(5)),
    ])
  }
  return coordinates
}

function bearing(a, b) {
  const p1 = radians(a.lat), p2 = radians(b.lat), dl = radians(b.lon-a.lon)
  const y = Math.sin(dl)*Math.cos(p2)
  const x = Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl)
  return (degrees(Math.atan2(y,x))+360)%360
}
function withinBounds(item, bounds) {
  const lon = item.longitude
  const insideLon = bounds.lomin <= bounds.lomax
    ? lon >= bounds.lomin && lon <= bounds.lomax
    : lon >= bounds.lomin || lon <= bounds.lomax
  return item.latitude >= bounds.lamin && item.latitude <= bounds.lamax && insideLon
}
function createAircraft(index, nowSeconds) {
  const random = seededRandom(index + 78431)
  const originIndex = Math.floor(random() * AIRPORTS.length)
  let destinationIndex = Math.floor(random() * (AIRPORTS.length - 1))
  if (destinationIndex >= originIndex) destinationIndex += 1
  const origin = AIRPORTS[originIndex]
  let destination = AIRPORTS[destinationIndex]
  const type = TYPES[Math.floor(random() * TYPES.length)]
  const airline = AIRLINES[Math.floor(random() * AIRLINES.length)]
  const callsign = airline[0] + (100 + Math.floor(random() * 8900))
  const isGround = random() < 0.065
  const cruiseSpeed = type[4] + random() * (type[5] - type[4])
  const distance = distanceKm(origin, destination)
  const duration = Math.max(35 * 60, distance / Math.max(100, cruiseSpeed * 1.852) * 3600)
  const progress = (nowSeconds / duration + random()) % 1
  let position = interpolate(origin, destination, progress)
  if (isGround) { position = {lat:origin.lat, lon:origin.lon}; destination = origin }

  // Approximate a realistic flight profile: acceleration after takeoff,
  // cruise in the middle of the route, then deceleration during descent.
  const climbPhase = !isGround && progress < 0.12
  const descentPhase = !isGround && progress > 0.86
  const phaseFactor = isGround ? 0 : climbPhase
    ? 0.72 + (progress / 0.12) * 0.28
    : descentPhase
      ? 1 - ((progress - 0.86) / 0.14) * 0.24
      : 1
  const speed = Math.round(cruiseSpeed * phaseFactor)
  const cruiseAltitude = Math.round((27000 + random() * 13000) / 100) * 100
  const altitudeFactor = isGround ? 0 : climbPhase
    ? Math.min(1, progress / 0.12)
    : descentPhase
      ? Math.max(0.04, 1 - (progress - 0.86) / 0.14)
      : 1
  const altitude = Math.round((cruiseAltitude * altitudeFactor) / 100) * 100
  const verticalRate = isGround ? 0
    : climbPhase ? 700 + Math.round(random() * 1800)
      : descentPhase ? -(600 + Math.round(random() * 1600))
        : Math.round((random() - 0.5) * 250)
  const flightHeading = isGround ? null : Math.round(bearing(position, destination)) % 360
  const id = 'demo-' + String(index+1).padStart(4,'0')
  return {
    id,
    icao24: 'd' + (index+1).toString(16).padStart(5,'0'),
    callsign,
    originCountry: origin.country,
    airline: airline[1],
    category: type[2],
    longitude: Number(position.lon.toFixed(5)),
    latitude: Number(position.lat.toFixed(5)),
    altitudeFt: altitude,
    onGround: isGround,
    speedKt: isGround ? 0 : Math.round(speed),
    heading: flightHeading,
    verticalRateFpm: verticalRate,
    squawk: String(1000 + (index % 7000)),
    lastSeenSeconds: 0,
    registration: 'DEMO-' + String(index+1).padStart(4,'0'),
    aircraftType: type[0],
    aircraftTypeCode: type[0],
    categoryCode: type[3],
    isHelicopter: type[2] === 'Helicopter',
    origin: origin.iata,
    destination: destination.iata,
    // The planned airport-to-airport route is displayed immediately in demo mode.
    routeCoordinates: isGround ? [] : createRouteCoordinates(origin, destination, 160),
    routeProgress: isGround ? 0 : progress,
    routeDurationSeconds: duration,
    routeProgressUpdatedAt: nowSeconds,
    isDemo: true,
  }
}

export function generateDemoAircraft(bounds, count = 1000) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const aircraft = []
  for (let index = 0; index < count; index += 1) {
    const item = createAircraft(index, nowSeconds)
    if (withinBounds(item, bounds)) aircraft.push(item)
  }
  return {
    source: 'AeroTrace Demo Simulator',
    mode: 'demo',
    time: nowSeconds,
    aircraft,
    totalSimulated: count,
  }
}

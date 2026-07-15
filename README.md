# 🏘️ PixelVille — drag & drop village builder

A cozy browser sandbox where **you drop the buildings and the village figures out the rest**.
Zero dependencies, zero image assets — every pixel-art sprite is generated procedurally in code.

## Run it

```
node server.js        # → http://localhost:8123
```

…or simply double-click `index.html` (it runs fine from a local file too).

## How it plays

- **Drop a house** → a road appears automatically, a family moves in (2 adults, sometimes a kid), and a car parks in the driveway.
- **Drop any building** → an A* pathfinder connects its front door to the existing road network, reusing roads where it can.
- **Drop a mountain** → roads can never cross rock, so new connections *carve around it*.
- **Drop a river or lake** → crossing water is expensive for the pathfinder, so roads only *bridge* it when a detour would be worse.
- **Drop workplaces** (office, factory, shop, mall…) → unemployed adults are hired at the nearest open job and start commuting every morning; long commutes use the family car.
- **Drop a school / college** → kids enroll and do the school run on weekdays; jobless adults attend college.
- **Drop shops & leisure** (cinema, park, restaurant, amusement park…) → villagers run daily errands and go out in the evenings; Sundays are for fun, not work. New venues get a **grand opening** rush and everyone at home replans their day.
- **Seasons** (7 days each): spring blossoms, summer fireflies, autumn leaves falling, winter snow — frozen lakes, bare trees, snow-capped roofs, cozy chimney smoke.
- **Weather**: seasonal-weighted clear/cloudy/rain/heavy rain/snow. Visible rain streaks and splashes, lightning in storms, drifting cloud shadows — and heavy rain leaves **puddles** that evaporate afterwards. People carry umbrellas and take the car sooner in the rain.
- **Real nights**: a lighting engine punches warm pools out of the darkness — glowing windows, street lamps, car headlights, hikers' torches, the amusement park's color show.
- **Mountains**: huge 5×5 ranges with hiking trails; hikers trek to the summit and back, and mysterious torch lights flicker on the peaks at night.
- **Crime & justice**: unemployment breeds night-time burglars (banks and malls are prime targets). Alarms ring, police cars race out with flashing lights, and a courthouse boosts conviction rates. Watch the 🛡️ safety stat — it feeds into happiness.
- **A real economy**: workers earn wages, households save, shops and venues earn what people spend. Families add floors to their homes (watch the scaffolding go up), buy second cars, become landlords with rental homes — and sometimes win the lottery. The 💰 stat tracks city-wide wealth.
- **The city grows itself**: when jobs outstrip housing, settlers build new homes — every building (yours or theirs) rises through a visible construction site with scaffolds, cranes, and workers. Road crews and renovation scaffolds appear around town.
- **Street life**: queues outside busy cinemas and restaurants, customers' cars parked outside venues, parks and playgrounds filling up on weekends, lunch-break crowds at noon.
- **Incidents**: street disputes that draw the police, car crashes with tow-truck cleanups, and building fires. Every emergency response is *visible*: the fire truck races across town with lights flashing and hoses the flames, patrol cars answer shop alarms, and when there's no station yet, neighbours grab buckets and run over — a building is only ever saved by responders you can watch on the scene.
- **Democracy** 🗳️: once enough adults live here, the village elects a mayor — after a full **campaign week**: coloured banners strung over the streets, daily rallies with crowds and a candidate on a soapbox, challengers making promises tied to the village's real needs, and incumbents pointing at what they actually built. Candidates have real personalities — pure-hearted visionaries, business minds, careful planners, and smooth-talking crooks. Each villager votes on their *own* quality of life and mood; a good mayor is re-elected every in-game year, a bad one is voted out, a corrupt one skims until auditors notice. Genuine grievances bring riots of the genuinely unhappy, and a disgraced mayor can be forced to resign.
- **The mayor's office** 🎩: an elected mayor gets a town hall built (the treasury pays, or the village chips in), moves into the office, commutes there daily, and flies a flag over the roof. Click the town hall to see who's in office, what they promised, and the treasury.
- **Community spirit** 🤝: when town hall ignores a real need for days, villagers pool their savings and build it themselves — fire stations and police fastest, then schools, homes, shops, parks. After a fire or collapse, neighbours rush to the site, emergency crews roll out, the street clears the rubble together, and the community rebuilds.
- **Personal ambitions & feelings**: every adult has a lifestyle — steady workers, shopkeepers saving for their own café, entrepreneurs, and a few risk-takers who may resort to petty theft (and face arrest). Founders buy a plot, build their shop, and quit the day job. Every villager also carries a **mood** shaped by work, savings, safety, fun and misfortune — it shows on their faces in the street, colours their ballot, decides who joins a protest, and feeds the town happiness stat.
- **Idle progress**: leave the game open and the village keeps governing, saving, building, and growing on its own — slowly and steadily (a day lasts ~6 real minutes at 1×), even while the tab is in the background.
- **Airport** ✈️: place one and planes take off and land on the runway; flights bring extra visitors to town.
- **Surprises**: hot-air balloons, shooting stars, rainbows after rain, and unexplained lights in the night sky.
- **SimCity-style HUD**: minimap (click to jump), R/C/I demand meters, city wealth readout, cast building shadows.

## Controls

| Action | Input |
| --- | --- |
| Place | click palette item, then click map (tool stays armed) |
| Roads / rivers / bulldoze | click & drag on the map |
| Pan | drag map, right/middle-drag, or WASD/arrows |
| Zoom | mouse wheel |
| Cancel tool | right-click or `Esc` |
| Inspect building | click it (residents, jobs, visitors, demolish) |
| Pause / speeds | space, or keys `1–4`, or the ⏸▶⏩⏭ buttons |
| Save / Load / New map | 💾 📂 🗺️ buttons (saves to browser localStorage) |

## Architecture

| File | Role |
| --- | --- |
| `js/sprites.js` | Procedural pixel-art generator + the `CAT` catalog (footprints, jobs, opening hours, draw functions for 30+ building types), seasonal tiles/trees, auto snow-caps, glow sprites |
| `js/world.js` | 128×128 tile grid, terrain stamps (river/lake/mountain/forest), building placement, **auto-road A\*** (terrain costs + turn penalty), road-network BFS for trips, save/load |
| `js/weather.js` | Season cycle, weather state machine, rain/snow/leaf particles, puddles, cloud shadows, lightning |
| `js/agents.js` | Citizens: families, job & school assignment, weather-aware daily planner (commute / errands / evenings out / weekends), movement along roads, car pool |
| `js/life.js` | Ambient life (hikers, birds, dogs, fireflies) + the crime & justice system (burglars, police dispatch, arrests, safety), fires & fire brigade, disasters, riots |
| `js/gov.js` | Village democracy: elections, leader personalities, taxes & treasury, mayoral building projects, grievances, and community self-building |
| `js/main.js` | Canvas renderer (cached ground layer, painter-sorted entities with soft shadows, darkness layer with punched-out light pools, emissive pass), camera, input, palette UI, HUD, toasts |

### The auto-road logic in one paragraph

Every building has a door tile on its south side. On placement, a Dijkstra/A* search runs from the
door over the terrain with costs: existing road `0.15`, grass `1`, trees `1.8` (cleared), water `7`
(becomes a bridge), rock/buildings `∞`, plus a small turn penalty so roads come out straight. The
search stops at the first existing road tile and lays road along the way back — which is why roads
merge into sensible networks, hug around mountains, and only bridge rivers when it's worth it.

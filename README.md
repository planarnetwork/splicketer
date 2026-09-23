# splicketer

Precompute where splitting a GB rail journey into several tickets can beat the through fare, so that a journey
planner can check for split tickets in real time.

```
npm run splits -- ../dtd2mysql/data/feeds splits.br --date=2026-09-22
```

This reads the fares feed (`RJFA*.ZIP`, the latest refresh plus the change files after it) and the routeing guide
(`RJRG*.ZIP`) and timetable (`RJTT*.ZIP`) from the directory and writes every split journey to `splits.br`. The full
network takes under four minutes on 64 cores and makes a 9 MB file.

| Option | |
|---|---|
| `--date` | Fares valid on this date. Defaults to today |
| `--routeing` | The routeing guide feed, when it is not next to the fares |
| `--timetable` | The timetable feed (`RJTT*.ZIP`) or its directory, when it is not next to the fares |
| `--split-penalty` | What each ticket after the first costs in the search, in pence. Defaults to 100 |
| `--permitted-stations` | The Knowledgebase `FareGroupPermittedStations` XML, when it is not next to the fares. `npm run download-permitted-stations` fetches it to `data/` from the Rail Data Marketplace bucket, with the AWS credentials in `.env` |
| `--with-prices` | Write the total price after each journey, for debugging |
| `WORKERS` | Worker threads. Defaults to the number of CPUs less two |

## What is precomputed

For every pair of stations, in each fare category, the cheapest combination of tickets where it is cheaper than the
through ticket, or where there is no through ticket in that category. Pairs where the through ticket is cheapest are
left out.

**Categories.** Standard class tickets for one adult without a railcard, grouped so a journey is only ever split
into tickets of the same kind:

| Category | Tickets |
|---|---|
| `ADV-S` | Advance singles |
| `OFP-S`, `OFP-R` | Off-peak and super off-peak singles and returns |
| `ANY-S`, `ANY-R` | Anytime singles and returns |

Tickets are categorised by their product name. Restriction and validity codes are shared with products that are not
tickets for one adult, such as under 16 fares, concessions, PAYG information fares and group tickets.

**Fares.** Fares are looked up as in `docs/Fares Lookup.md`: a station's own NLC, its fare group, the hardcoded
additional locations and the London zones; one flow per route for each pair of locations, preferring NLC over cluster
and usage code A over G; and non-derivable fares replacing or suppressing flow fares.

**Fare groups.** A fare to or from a fare group such as London Terminals is only used for the stations of the group
the Knowledgebase fare group permitted stations list for the location at the other end and the fare's route. Where
nothing is listed, or the file is not given, every station of the group may use it.

**Routes.** The tickets of a split are either all any permitted (routes `00000` and `01000`, which only excludes
Southsea Hoverport), or a mix of any permitted tickets and
tickets for one other route code, so a split never relies on two different route restrictions at once. A split is
compared with the cheapest through ticket on any route. Each route is searched by carrying on from the any permitted
result, only from the stations its fares make cheaper, and only where that could still make a destination cheaper.

**Routeing.** A split point must be on a route the National Routeing Guide permits between the origin and destination:
on a local journey to one of the origin's routeing points, on a permitted route between routeing points, or on a local
journey from the destination's. See `@gb-transit/routeing-source` for how permitted routes are worked out and what is
not modelled.

**Split points** must also be:

- stations a passenger train makes a public call at, in the timetable over the date
- further from the origin than the split point before, and nearer the destination's routeing point, by the routeing
  guide's distances. Journeys local to the origin's routeing point only have to move away from the origin.
- not forbidden by a negative easement between the origin and destination. Easements that only apply to other routes,
  to a train company or ticket type, or on some days or at some times, are not applied.

Each ticket after the first costs the split penalty on top of its fare in the search, so a split has to save at least
that much per extra ticket, and of two splits that save the same the one with fewer tickets wins. Prices written with
`--with-prices` are without it.

Stations without routeing guide data (trams, buses, ferries and some duplicate codes) are not part of any split.

## Output

One file, brotli compressed unless the name ends in `.gz`. Each section starts with a `#CATEGORY ROUTE` line, followed
by its journeys as the concatenated CRS codes of the origin, the split points and the destination, sorted and front
coded: the first character is how many stations the line shares with the one before (`'0' + n`), followed by the rest.

```
#ANY-S 00000
0NRWDISLST       NRW DIS LST
2SMKIPS          NRW DIS SMK IPS
#ANY-S 00700
0NRWELYCBG       NRW ELY CBG, with any permitted and route 00700 tickets
```

## Querying

```ts
import { loadSplitFile, planSplits } from "splicketer";

const splits = await loadSplitFile("splits.br");

splits.split("ANY-S", "NRW", "IPS");   // {route: "00000", points: ["DIS", "SMK"]}

planSplits(splits, "ANY-S", callingPoints, (from, to, route) => liveFare(from, to, route));
// {route: "00000", segments: [[["NRW", "DIS"], 550], [["DIS", "LST"], 6000]]}
```

`planSplits` keeps, for each route, the calling points that are a split point of the cheapest split between two of
the journey's calling points on that route or on any permitted tickets, and drops the rest. It then runs
[least-weight-subsequence](https://www.npmjs.com/package/least-weight-subsequence) over each route's candidates with
the fares given, which should be the cheapest ticket valid for that route or any permitted, and returns the cheapest.
`planSplitsAsync` does the same with fares looked up asynchronously.

Loading the full file takes about two seconds and 420 MB. Finding the candidates for a journey takes a few microseconds.

## Daily releases and the website

`.github/workflows/splits.yml` runs every morning:

1. Downloads the fares, timetable and routeing guide feeds from the DTD, the fare group permitted stations from the
   Rail Data Marketplace bucket, and gb-transit's latest GTFS feed for station names and coordinates.
2. Searches the origins in 16 shards in parallel (`--shard=N/16`), since the whole network is several CPU hours.
3. Merges the shards (`npm run merge-splits`) and releases `splits.br`, `splits-meta.json` and `stations.json` as
   `splits-YYYY-MM-DD`. The last 30 releases and the first of each month are kept.

It needs the `DTD_USERNAME`, `DTD_PASSWORD` and `DTD_HOSTNAME` secrets for the feeds, and `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` for the bucket, which is in `eu-west-2`.

`.github/workflows/pages.yml` then builds `site/` with the latest release copied in and deploys it to GitHub Pages.
A page cannot fetch a release asset itself, as they are served without CORS headers. The site reads the whole split
file in a worker, decompressing the brotli with `brotli-dec-wasm`, and shows where to split a journey between two
stations in each category on a map.

To work on the site, put a `splits.br`, `splits-meta.json` and `stations.json` in `site/public` and run
`npm run dev --prefix site`. `npm run stations -- gtfs.zip stations.json` writes the stations from a GTFS feed.

## Development

```
npm test       # biome lint, tsc and vitest
npm run perf   # load time and candidate lookups against splits.br
```

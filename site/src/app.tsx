import { useEffect, useMemo, useState } from "react";
import { type CategorySplit, Splits } from "./data/splits";
import { Stations } from "./data/stations";
import { MapView } from "./components/mapView";
import { StationInput } from "./components/stationInput";
import type { Theme } from "./theme/colors";
import styles from "./app.module.css";

const DATA = import.meta.env.BASE_URL;
const SPLITS_URL = import.meta.env.VITE_SPLITS_URL ?? `${DATA}splits.br`;
const STATIONS_URL = import.meta.env.VITE_STATIONS_URL ?? `${DATA}stations.json`;
const META_URL = import.meta.env.VITE_META_URL ?? `${DATA}splits-meta.json`;

const CATEGORY_NAMES: Record<string, string> = {
  "ADV-S": "Advance single",
  "OFP-S": "Off-peak single",
  "OFP-R": "Off-peak return",
  "ANY-S": "Anytime single",
  "ANY-R": "Anytime return"
};

const ANY_PERMITTED = "00000";

type Loading =
  | {state: "loading", received: number, total: number | undefined}
  | {state: "ready"}
  | {state: "error", message: string};

interface Query {
  origin: string;
  destination: string;
  splits: CategorySplit[];
}

export function App() {
  const theme: Theme = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const [stations, setStations] = useState<Stations | undefined>();
  const [loading, setLoading] = useState<Loading>({state: "loading", received: 0, total: undefined});
  const [builtOn, setBuiltOn] = useState<string | undefined>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState<Query | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    Stations.load(STATIONS_URL).then(setStations, (error: Error) => setLoading({state: "error", message: error.message}));
    fetch(META_URL).then(response => (response.ok ? response.json() : undefined)).then(meta => setBuiltOn(meta?.date), () => undefined);
  }, []);

  const [splits, setSplits] = useState<Splits | undefined>();

  useEffect(() => {
    const opened = new Splits(
      SPLITS_URL,
      (received, total) => setLoading({state: "loading", received, total}),
      () => setLoading({state: "ready"}),
      error => setLoading({state: "error", message: error})
    );

    setSplits(opened);

    return () => opened.close();
  }, []);

  const search = async () => {
    if (stations === undefined || splits === undefined || loading.state !== "ready") {
      return;
    }

    const origin = stations.resolve(from);
    const destination = stations.resolve(to);

    if (origin === undefined || destination === undefined) {
      setMessage(`No station called ${origin === undefined ? from : to}`);
      return;
    }
    if (origin.code === destination.code) {
      setMessage("Choose two different stations");
      return;
    }

    setMessage(undefined);
    setFrom(stations.label(origin.code));
    setTo(stations.label(destination.code));

    const found = await splits.query(origin.code, destination.code);

    setQuery({origin: origin.code, destination: destination.code, splits: found});
    setSelected(found.find(result => result.split !== undefined)?.category);
  };

  const path = useMemo(() => {
    const chosen = query?.splits.find(result => result.category === selected)?.split;

    return query === undefined ? [] : [query.origin, ...(chosen?.points ?? []), query.destination];
  }, [query, selected]);

  return (
    <div className={styles.app}>
      <div className={styles.panel}>
        <h1 className={styles.title}>SPLICKETER</h1>
        <p className={styles.intro}>
          Where splitting a GB rail journey into several tickets of the same kind can be cheaper than one through
          ticket. Each split is at stations on a route the National Routeing Guide permits.
        </p>

        {stations === undefined ? (
          <div className={styles.status}>Loading stations…</div>
        ) : (
          <>
            <StationInput title="From" placeholder="Station or CRS code" value={from} stations={stations} onChange={setFrom} onSubmit={search} />
            <StationInput title="To" placeholder="Station or CRS code" value={to} stations={stations} onChange={setTo} onSubmit={search} />
          </>
        )}

        <LoadingStatus loading={loading} />
        {message !== undefined && <div className={`${styles.status} ${styles.error}`}>{message}</div>}

        {query !== undefined && stations !== undefined && (
          <div className={styles.results}>
            {query.splits.map(({category, split}) => (
              <button
                type="button"
                key={category}
                disabled={split === undefined}
                className={category === selected ? `${styles.result} ${styles.selected}` : styles.result}
                onClick={() => setSelected(category)}
              >
                <span className={styles.category}>
                  <span>{CATEGORY_NAMES[category] ?? category}</span>
                  {split !== undefined && (
                    <span className={styles.route}>{split.route === ANY_PERMITTED ? "any permitted" : `route ${split.route}`}</span>
                  )}
                </span>
                {split === undefined ? (
                  <span className={styles.none}>The through ticket is the cheapest</span>
                ) : (
                  <span className={styles.stops}>
                    Split at
                    {split.points.map((point, i) => (
                      <span key={point} className={styles.stop}>
                        {stations.name(point)}
                        {i < split.points.length - 1 ? "," : ""}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className={styles.footer}>
          {builtOn !== undefined && <>Fares for {builtOn}. </>}
          Built from the Rail Delivery Group's fares, routeing guide and timetable feeds.{" "}
          <a href="https://github.com/planarnetwork/splicketer">Source</a>
        </div>
      </div>

      <div className={styles.map}>
        {stations !== undefined && <MapView stations={stations} path={path} theme={theme} />}
      </div>
    </div>
  );
}

function LoadingStatus({loading}: {loading: Loading}) {
  if (loading.state === "ready") {
    return null;
  }
  if (loading.state === "error") {
    return <div className={`${styles.status} ${styles.error}`}>{loading.message}</div>;
  }

  const megabytes = (loading.received / 1e6).toFixed(1);
  const share = loading.total === undefined ? undefined : loading.received / loading.total;

  return (
    <div className={styles.status}>
      {share === undefined || share < 1 ? `Downloading split tickets… ${megabytes} MB` : "Reading split tickets…"}
      <div className={styles.progress}>
        <div style={{width: `${Math.round((share ?? 0) * 100)}%`}} />
      </div>
    </div>
  );
}

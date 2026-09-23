import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Stations } from "../data/stations";
import { MAP_COLORS, type Theme } from "../theme/colors";

interface MapViewProps {
  stations: Stations;
  /** CRS codes of the origin, the split points and the destination, in order */
  path: readonly string[];
  theme: Theme;
}

const GB: L.LatLngBoundsExpression = [[49.9, -6.4], [58.7, 1.8]];

/**
 * Every station as a faint dot, and the journey as a line through its split points, from the journey planning
 * comparison site's map
 */
export function MapView({stations, path, theme}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const network = useRef<L.LayerGroup | null>(null);
  const route = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (container.current === null) {
      return;
    }

    const instance = L.map(container.current, {
      zoomControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      // thousands of station dots
      preferCanvas: true
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 17
    }).addTo(instance);

    network.current = L.layerGroup().addTo(instance);
    route.current = L.layerGroup().addTo(instance);
    instance.fitBounds(GB, {animate: false});
    map.current = instance;

    const observer = new ResizeObserver(() => instance.invalidateSize({animate: false, pan: false}));
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = network.current;

    if (layer === null) {
      return;
    }

    layer.clearLayers();

    for (const station of stations.all) {
      L.circleMarker([station.lat, station.lon], {
        radius: 1.4,
        weight: 0,
        fillColor: MAP_COLORS[theme].station,
        fillOpacity: 0.45,
        interactive: false
      }).addTo(layer);
    }
  }, [stations, theme]);

  useEffect(() => {
    const layer = route.current;
    const instance = map.current;

    if (layer === null || instance === null) {
      return;
    }

    layer.clearLayers();

    const points = path.flatMap(code => {
      const station = stations.at(code);

      return station === undefined ? [] : [{station, latLng: L.latLng(station.lat, station.lon)}];
    });

    if (points.length < 2) {
      return;
    }

    const colors = MAP_COLORS[theme];
    const line = points.map(point => point.latLng);

    L.polyline(line, {color: "#000", weight: 8, opacity: 0.18, interactive: false}).addTo(layer);
    L.polyline(line, {color: colors.route, weight: 3.6, opacity: 0.97, interactive: false}).addTo(layer);

    points.forEach(({station, latLng}, i) => {
      const end = i === 0 || i === points.length - 1;

      L.circleMarker(latLng, {
        radius: end ? 5 : 4,
        color: end ? colors.route : colors.split,
        weight: 2.4,
        fillColor: end ? colors.end : colors.split,
        fillOpacity: 1
      })
        .bindTooltip(station.name, {direction: "top", permanent: !end && points.length <= 8})
        .addTo(layer);
    });

    instance.fitBounds(L.latLngBounds(line).pad(0.25), {animate: false});
  }, [stations, path, theme]);

  return <div ref={container} style={{height: "100%", width: "100%"}} />;
}

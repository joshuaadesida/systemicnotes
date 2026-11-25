# Winnipeg Housing & Zoning Reform Simulator

An independent SystemicNotes project by Joshua Adesida. The simulator tests ten-year redevelopment scenarios and compares them with Winnipeg’s observed building-permit history and published housing-cost burden. The author’s note describes the project’s origins and the case for public, non-market and Indigenous-led housing.

[Open the public simulator](https://joshuaadesida.github.io/systemicnotes/winnipeg-housing-zoning-simulator/)

## Run locally

Use Node 22.12 or newer and pnpm. The checked-in aggregate snapshot is sufficient for the application.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm build
```

Vite produces a portable static build in `dist/`. Serve it over HTTP from any path. The local source and the public build both use the same aggregate GeoJSON.

## Data and model

The November 25, 2026 snapshot covers 237 official neighbourhood polygons. It includes 173,674 matched detached assessment records used as candidate lots, of which 102,699 are within the 800 m model buffer. The mapped permit history recorded 32,995 net units in 2019–2025. There are 200 matched neighbourhood census profiles and 187 published rent-burden rates. South Pointe West's 1,161 detached records were excluded because their assessment label has no matching City neighbourhood polygon. One matched candidate had no usable geometry. Two different source labels use permit area code 5.530. Their records follow the published name. One misspelling of Leila North and seven abbreviated assessment labels have explicit crosswalks in the pipeline.

- Four-unit preset. All near-transit candidates, plus an assumed 25% of the remainder. One existing home per candidate is deducted.
- Six-unit preset. All candidates, with optional 12 net homes per redeveloped near-transit parcel. The transit buffer approximates straight-line proximity using BLUE, F and FX stops. The City's official property map governs legal eligibility.
- Servicing switch. A uniform slowdown in take-up by a factor of 0.6. Separate sewer-system engineering data would be needed for neighbourhood-specific constraints.
- Fiscal and housing outcomes. The assumed $2,450 annual property-tax amount per added home is gross. Affordability and tenure are observed from the census. The public and non-market percentage is a hypothetical allocation of simulated net homes. The model does not forecast rents, project feasibility or homelessness.
- Real-world scope. The pipeline joins assessment records, not zoning hectares. It does not model independent buildout on commercial or formerly vacant land. Permits are an issued/closed series, and counting of multi-unit permits changed in November 2022.

See the methods and source links on the public project for details. The snapshot contains aggregate neighbourhood data only.

## Rebuild the open-data snapshot

The sources are live and a later refresh can return different results. The exact GTFS schedule vintage used here ran September 6 through December 12, 2026. For a reproducible rerun, use an archive of that feed and the matching source snapshot. Run the scripts from the source directory.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install 'shapely>=2.1,<3' 'pyproj>=3.7,<4' 'pymupdf>=1.26,<3'
python research/query_winnipeg.py raw
python research/download_rolls.py raw
python research/download_census.py raw
curl -fL https://gtfs.winnipegtransit.com/google_transit.zip -o raw/transit.zip
python research/extract_census.py raw/census-pdfs raw/census-values.json
python research/build_snapshot.py raw public/winnipeg_haf_neighbourhoods.geojson --date YYYY-MM-DD
```

Source catalogues include [Winnipeg open data](https://data.winnipeg.ca), [Winnipeg Transit GTFS](https://gtfs.winnipegtransit.com/google_transit.zip), [2021 City neighbourhood profiles](https://legacy.winnipeg.ca/census/2021/) and the [2024 Winnipeg Street Census](https://archive.endhomelessnesswinnipeg.ca/2024-winnipeg-street-census-report/).

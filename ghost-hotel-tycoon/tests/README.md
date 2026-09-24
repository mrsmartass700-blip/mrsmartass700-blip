# Tests

Run from `ghost-hotel-tycoon/`.

## Unit tests: `lune run tests/run`

Works with stock [Lune](https://lune-org.github.io/docs) 0.10.

- compiles every source file;
- checks config sanity, number formatting, odds, economy formulas;
- builds every ghost (every mutation) and the whole map as real Roblox
  instances. Lune checks each property against Roblox's API, so a wrong
  property name or type fails the test;
- checks map geometry: plots face the right way and don't overlap each
  other, the graveyard or the rooms.

## End-to-end simulation: `lune run tests/simulate`

Boots the real `Main.server` script on a mocked engine (`tests/lib/Engine.luau`)
and plays through the game: joining, catching a ghost with the vacuum, checking
it in, collecting income, building, unlocking rooms, upgrades, fusing,
releasing, Robux receipts (including duplicates), game passes, rebirth,
leaving/rejoining through a fake DataStore, and shutdown. It then boots the
real client LocalScripts as a player and drives the HUD, shop, rebirth panel,
prompt filtering, mini ghosts and the VIP chat tag.

The engine mock overrides a few reflected properties (such as
`BasePart.Position`). Stock Lune does not allow that, so the simulation needs a
Lune build with `tests/lune-roblox.patch` applied:

```bash
cargo install lune --version 0.10.5 --locked            # pulls the sources
cp -r ~/.cargo/registry/src/*/lune-roblox-0.3.5 lune-roblox
cp -r ~/.cargo/registry/src/*/lune-0.10.5 lune-src
patch -d lune-roblox -p1 < tests/lune-roblox.patch
printf '\n[patch.crates-io]\nlune-roblox = { path = "../lune-roblox" }\n' >> lune-src/Cargo.toml
cargo build --release --manifest-path lune-src/Cargo.toml
lune-src/target/release/lune run tests/simulate
```

Known Lune quirks the tests work around: `CFrame.lookAt` returns a transposed
rotation for some directions (so `MapBuilder` uses `CFrame.Angles`), and Ref
properties can't be set to `nil`.

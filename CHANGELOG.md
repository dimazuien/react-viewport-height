## [2.0.0](https://github.com/dimazuien/react-viewport-height/compare/v1.3.0...v2.0.0) (2026-11-27)

### ⚠ BREAKING CHANGES

- The build targets the browsers that Baseline lists as widely available, Chrome 125, Edge 125, Firefox 126, and Safari 17.5 today, instead of ES2020. The target moves forward with Baseline.
- The package needs React 18 or 19.
- The exports map exposes only the root entry point and package.json, so deep imports no longer resolve. The UMD bundle in lib/ and the root index.d.ts are gone, and the code now targets ES2020 instead of ES5.

### Features

- read the viewport height with useSyncExternalStore ([cac53d0](https://github.com/dimazuien/react-viewport-height/commit/cac53d08f251636be385568a784dbe5dc3dee5e5))

### Build System

- ship ESM and CommonJS builds with an exports map ([6726896](https://github.com/dimazuien/react-viewport-height/commit/67268960a6238669564ea11f19208f3964722528))
- target Baseline widely available browsers ([97ac4e2](https://github.com/dimazuien/react-viewport-height/commit/97ac4e268c239dfff7e1b71b664d6b4739cdeeef))

## [1.3.0](https://github.com/dimazuien/react-viewport-height/compare/v1.2.2...v1.3.0) (2026-11-27)

### Features

- support React 19 ([f272565](https://github.com/dimazuien/react-viewport-height/commit/f27256503809079511bc9aafa06874aefb5042b3))

## [1.2.2](https://github.com/dimazuien/react-viewport-height/compare/v1.2.1...v1.2.2) (2023-07-31)

### Bug Fixes

- change webpack config to build nodejs-compatible bundle ([80a4596](https://github.com/dimazuien/react-viewport-height/commit/80a4596054cb73cab978d3f4601fd9cf2b264f19)), closes [#211](https://github.com/dimazuien/react-viewport-height/issues/211)

## [1.2.1](https://github.com/dimazuien/react-viewport-height/compare/v1.2.0...v1.2.1) (2022-07-17)

### Bug Fixes

- validating server side properly and removing layoutEffect to not get a NextJS warning ([91b8021](https://github.com/dimazuien/react-viewport-height/commit/91b802190ba9e25eb50d916680a8c769da5a3c12))

# [1.2.0](https://github.com/dimazuien/react-viewport-height/compare/v1.1.3...v1.2.0) (2022-04-03)

### Bug Fixes

- replace useEffect with useLayoutEffect ([c9fd013](https://github.com/dimazuien/react-viewport-height/commit/c9fd013f64963070ea90faaa5afdd9d9efb1552a))

### Features

- add support for react 18 ([ce48cbc](https://github.com/dimazuien/react-viewport-height/commit/ce48cbc10959b42b21aa421f3ea6a4ba2104d70c))

## [1.1.3](https://github.com/dimazuien/react-viewport-height/compare/v1.1.2...v1.1.3) (2021-02-22)

### Bug Fixes

- include files definitions into package ([eea4d8e](https://github.com/dimazuien/react-viewport-height/commit/eea4d8e353935130c8e3b81397a76edbe0ace328))

## [1.1.2](https://github.com/dimazuien/react-viewport-height/compare/v1.1.1...v1.1.2) (2021-02-22)

### Bug Fixes

- fix typing paths ([9d20410](https://github.com/dimazuien/react-viewport-height/commit/9d204101a9dd1b2d57858db965838dcd971d019c)), closes [#73](https://github.com/dimazuien/react-viewport-height/issues/73)

## [1.1.1](https://github.com/dimazuien/react-viewport-height/compare/v1.1.0...v1.1.1) (2021-02-22)

### Bug Fixes

- change typings path ([8587a9a](https://github.com/dimazuien/react-viewport-height/commit/8587a9a84d374daf3c7fd5d43176e6da0596d8ef)), closes [#73](https://github.com/dimazuien/react-viewport-height/issues/73)

# [1.1.0](https://github.com/dimazuien/react-viewport-height/compare/v1.0.0...v1.1.0) (2020-12-27)

### Features

- add ssr check ([8b60760](https://github.com/dimazuien/react-viewport-height/commit/8b60760dd5a6a1c2059a591a2640511d09ab0e0a))
- remove vh on unmount ([8b60760](https://github.com/dimazuien/react-viewport-height/commit/8b60760dd5a6a1c2059a591a2640511d09ab0e0a))
- return vh from hook ([8b60760](https://github.com/dimazuien/react-viewport-height/commit/8b60760dd5a6a1c2059a591a2640511d09ab0e0a))
- make multiple use possible ([8b60760](https://github.com/dimazuien/react-viewport-height/commit/8b60760dd5a6a1c2059a591a2640511d09ab0e0a))

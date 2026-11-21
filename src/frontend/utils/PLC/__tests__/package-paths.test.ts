import { describe, expect, it } from '@jest/globals'

import {
  childPackages,
  collectPackagePaths,
  dataTypeRelativePath,
  detectPouTypeFromContent,
  isPackageRelativePath,
  isSameOrInsidePackage,
  isValidPackagePath,
  isVisibleFromPackage,
  joinPackagePath,
  normalizePackagePath,
  packageFolder,
  packageFromRelativePath,
  packageName,
  packagePathsEqual,
  packageSegments,
  parentPackage,
  pouRelativePath,
  rebasePackagePath,
  validatePackagePath,
} from '../package-paths'

describe('package path basics', () => {
  it('normalizes separators, whitespace and empty segments', () => {
    expect(normalizePackagePath(' Motion / Axis// ')).toBe('Motion/Axis')
    expect(normalizePackagePath('Motion\\Axis')).toBe('Motion/Axis')
    expect(normalizePackagePath(undefined)).toBe('')
    expect(normalizePackagePath('')).toBe('')
  })

  it('splits into segments, the root having none', () => {
    expect(packageSegments('A/B')).toEqual(['A', 'B'])
    expect(packageSegments('')).toEqual([])
  })

  it('accepts IEC identifiers only, and the root', () => {
    expect(isValidPackagePath('Motion/Axis_1')).toBe(true)
    expect(isValidPackagePath('')).toBe(true)
    expect(isValidPackagePath('1Motion')).toBe(false)
    expect(isValidPackagePath('../escape')).toBe(false)
    expect(validatePackagePath('My Package')).toContain('"My Package" is not a valid package name')
  })

  it('names, parents and joins', () => {
    expect(packageName('A/B/C')).toBe('C')
    expect(packageName('')).toBe('')
    expect(parentPackage('A/B/C')).toBe('A/B')
    expect(parentPackage('A')).toBe('')
    expect(joinPackagePath('A', 'B')).toBe('A/B')
    expect(joinPackagePath('', 'B')).toBe('B')
  })

  it('compares paths ignoring case', () => {
    expect(packagePathsEqual('Motion', 'motion')).toBe(true)
    expect(packagePathsEqual(undefined, '')).toBe(true)
    expect(packagePathsEqual('A', 'B')).toBe(false)
  })
})

describe('containment and visibility', () => {
  it('treats a package as inside itself and the root as containing everything', () => {
    expect(isSameOrInsidePackage('A/B', 'A')).toBe(true)
    expect(isSameOrInsidePackage('A', 'a')).toBe(true)
    expect(isSameOrInsidePackage('AB', 'A')).toBe(false)
    expect(isSameOrInsidePackage('A', '')).toBe(true)
    expect(isSameOrInsidePackage('', 'A')).toBe(false)
  })

  it('lets code see its own package, its ancestors and the root', () => {
    expect(isVisibleFromPackage('', 'A/B')).toBe(true)
    expect(isVisibleFromPackage('A', 'A/B')).toBe(true)
    expect(isVisibleFromPackage('A/B', 'A/B')).toBe(true)
    expect(isVisibleFromPackage(undefined, undefined)).toBe(true)
  })

  it('hides children and siblings', () => {
    expect(isVisibleFromPackage('A/B', 'A')).toBe(false)
    expect(isVisibleFromPackage('C', 'A')).toBe(false)
    expect(isVisibleFromPackage('A', '')).toBe(false)
  })
})

describe('file paths', () => {
  it('keeps root elements in the legacy layout', () => {
    expect(pouRelativePath({ name: 'Main', pouType: 'program', language: 'st' })).toBe('pous/programs/Main.st')
    expect(pouRelativePath({ name: 'Fb', pouType: 'function-block', package: '', language: 'ld' })).toBe(
      'pous/function-blocks/Fb.ld',
    )
    expect(dataTypeRelativePath({ name: 'Mode' })).toBe('datatypes/Mode.dt')
  })

  it('puts packaged elements in one folder per package', () => {
    expect(pouRelativePath({ name: 'Axis', pouType: 'function-block', package: 'Motion', language: 'st' })).toBe(
      'packages/Motion/Axis.st',
    )
    expect(dataTypeRelativePath({ name: 'AxisState', package: 'Motion/Types' })).toBe(
      'packages/Motion/Types/AxisState.dt',
    )
    expect(packageFolder('')).toBe('')
    expect(packageFolder('A/B')).toBe('packages/A/B')
  })

  it('reads the package back from a relative path', () => {
    expect(packageFromRelativePath('packages/Motion/Axis.st')).toBe('Motion')
    expect(packageFromRelativePath('packages\\Motion\\Types\\State.dt')).toBe('Motion/Types')
    expect(packageFromRelativePath('pous/programs/Main.st')).toBe('')
    expect(packageFromRelativePath('packages/loose.st')).toBe('')
    expect(isPackageRelativePath('packages\\A\\x.st')).toBe(true)
    expect(isPackageRelativePath('pous/programs/x.st')).toBe(false)
  })
})

describe('detectPouTypeFromContent', () => {
  it('reads the kind after the documentation comment', () => {
    expect(detectPouTypeFromContent('(* doc *)\nFUNCTION_BLOCK Axis\nEND_FUNCTION_BLOCK')).toBe('function-block')
    expect(detectPouTypeFromContent('FUNCTION Add : INT\nEND_FUNCTION')).toBe('function')
    expect(detectPouTypeFromContent('  program Main\nEND_PROGRAM')).toBe('program')
  })

  it('returns null without a header', () => {
    expect(detectPouTypeFromContent('x := 1;')).toBeNull()
  })
})

describe('collecting the package tree', () => {
  it('merges declared and occupied packages with their ancestors, parents first', () => {
    const paths = collectPackagePaths(
      [{ path: 'Empty' }, { path: 'motion' }],
      [{ package: 'Motion/Axis' }, {}],
      [{ package: 'Io' }],
    )
    expect(paths).toEqual(['Empty', 'Io', 'motion', 'motion/Axis'])
  })

  it('lists the direct children of a package', () => {
    const paths = ['A', 'A/B', 'A/B/C', 'A/D', 'E']
    expect(childPackages(paths, '')).toEqual(['A', 'E'])
    expect(childPackages(paths, 'A')).toEqual(['A/B', 'A/D'])
  })

  it('rebases a path onto a new parent', () => {
    expect(rebasePackagePath('A/B/C', 'A/B', 'X')).toBe('X/C')
    expect(rebasePackagePath('A', 'A', 'Z/Y')).toBe('Z/Y')
  })
})

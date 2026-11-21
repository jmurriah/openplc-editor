import { describe, expect, it } from '@jest/globals'

import type { PLCDataType, PLCGlobalVariableList, PLCPou } from '../../../../middleware/shared/ports/types'
import { describePackageVisibilityViolation, findPackageVisibilityViolations } from '../package-visibility'

const stPou = (
  name: string,
  pouType: PLCPou['pouType'],
  body: string,
  pkg?: string,
  variables: PLCPou['interface'] extends infer I ? (I extends { variables: infer V } ? V : never) : never = [],
): PLCPou => ({
  name,
  pouType,
  ...(pkg ? { package: pkg } : {}),
  interface: { variables },
  body: { language: 'st', value: body },
})

const struct = (name: string, pkg?: string, fieldType = 'INT'): PLCDataType => ({
  name,
  derivation: 'structure',
  ...(pkg ? { package: pkg } : {}),
  variable: [{ name: 'f', type: { definition: 'derived', value: fieldType } }],
})

describe('findPackageVisibilityViolations', () => {
  it('reports nothing for a project without packages', () => {
    const pous = [stPou('Main', 'program', 'Helper(1);'), stPou('Helper', 'function', '')]
    expect(findPackageVisibilityViolations({ pous, dataTypes: [] })).toEqual([])
  })

  it('tolerates a partially loaded project', () => {
    expect(findPackageVisibilityViolations({})).toEqual([])
  })

  it('allows the own package, ancestors and the root', () => {
    const pous = [
      stPou('Main', 'program', 'x := RootFn(1) + MotionFn(2) + AxisFn(3);', 'Motion/Axis'),
      stPou('RootFn', 'function', ''),
      stPou('MotionFn', 'function', '', 'Motion'),
      stPou('AxisFn', 'function', '', 'Motion/Axis'),
    ]
    expect(findPackageVisibilityViolations({ pous, dataTypes: [] })).toEqual([])
  })

  it('flags a call into a sibling package', () => {
    const pous = [stPou('Main', 'program', 'x := IoFn(1);', 'Motion'), stPou('IoFn', 'function', '', 'Io')]
    const violations = findPackageVisibilityViolations({ pous, dataTypes: [] })
    expect(violations).toEqual([
      {
        user: 'Main',
        userKind: 'POU',
        userPackage: 'Motion',
        symbol: 'IoFn',
        symbolKind: 'function',
        symbolPackage: 'Io',
      },
    ])
    expect(describePackageVisibilityViolation(violations[0])).toContain('package "Io"')
  })

  it('flags root code using a packaged function block instance type', () => {
    const pous = [
      stPou('Main', 'program', '', undefined, [
        {
          name: 'ax',
          class: 'local',
          type: { definition: 'derived', value: 'AxisFb' },
          location: '',
          documentation: '',
        },
      ]),
      stPou('AxisFb', 'function-block', '', 'Motion'),
    ]
    const [violation] = findPackageVisibilityViolations({ pous, dataTypes: [] })
    expect(violation.symbolKind).toBe('function block')
    expect(describePackageVisibilityViolation(violation)).toContain('the project root')
  })

  it('ignores names inside comments and strings', () => {
    const pous = [
      stPou('Main', 'program', "(* IoFn *) // IoFn\ns := 'IoFn';", 'Motion'),
      stPou('IoFn', 'function', '', 'Io'),
    ]
    expect(findPackageVisibilityViolations({ pous, dataTypes: [] })).toEqual([])
  })

  it('checks data types used by other data types and qualified list access', () => {
    const lists: PLCGlobalVariableList[] = [{ name: 'IoVars', variables: [], package: 'Io' }]
    const dataTypes = [struct('Outer', 'Motion', 'Inner'), struct('Inner', 'Io')]
    const pous = [stPou('Main', 'program', 'IoVars.start := TRUE;', 'Motion')]
    const kinds = findPackageVisibilityViolations({ pous, dataTypes, globalVariableLists: lists }).map(
      (v) => `${v.user}->${v.symbol}`,
    )
    expect(kinds).toEqual(['Main->IoVars', 'Outer->Inner'])
  })

  it('does not scan Python or C++ bodies, only their declarations', () => {
    const pous: PLCPou[] = [
      { name: 'Py', pouType: 'function-block', package: 'A', body: { language: 'python', value: 'IoFn()' } },
      stPou('IoFn', 'function', '', 'Io'),
    ]
    expect(findPackageVisibilityViolations({ pous, dataTypes: [] })).toEqual([])
  })

  it('scans graphical bodies through their strings', () => {
    const pous: PLCPou[] = [
      {
        name: 'Ld',
        pouType: 'program',
        package: 'A',
        body: { language: 'ld', value: { rungs: [{ nodes: [{ data: { variant: { name: 'IoFn' } } }] }] } },
      },
      stPou('IoFn', 'function', '', 'Io'),
    ]
    expect(findPackageVisibilityViolations({ pous, dataTypes: [] })).toHaveLength(1)
  })
})

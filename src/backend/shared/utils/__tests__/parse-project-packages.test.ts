import { describe, expect, it } from '@jest/globals'

import type { RawProjectFile } from '../../../../middleware/shared/ports/project-port'
import { parseProjectFiles } from '../parse-project-files'

const projectJson = (data: Record<string, unknown> = {}) =>
  JSON.stringify({
    meta: { name: 'P', type: 'plc-project' },
    data: {
      dataTypes: [],
      pous: [],
      configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      ...data,
    },
  })

const deviceConfig = JSON.stringify({ deviceBoard: 'uno', communicationPort: 'COM1', compileOnly: false })

const parse = (pouFiles: RawProjectFile[], dataTypeFiles: RawProjectFile[] = [], data: Record<string, unknown> = {}) =>
  parseProjectFiles('/p', projectJson(data), deviceConfig, '[]', pouFiles, [], [], '', dataTypeFiles)

const st = (keyword: string, name: string, end: string) =>
  `${keyword} ${name}\n  VAR\n    x : INT;\n  END_VAR\n  x := 1;\n${end}\n`

describe('parseProjectFiles — packages', () => {
  it('reads a POU kind from its header inside a package folder', () => {
    const result = parse([
      { relativePath: 'packages/Motion/Axis.st', content: st('FUNCTION_BLOCK', 'Axis', 'END_FUNCTION_BLOCK') },
      { relativePath: 'packages\\Motion\\Main.st', content: st('PROGRAM', 'Main', 'END_PROGRAM') },
    ])
    const byName = Object.fromEntries(result.projectData.pous.map((pou) => [pou.name, pou]))
    expect(byName.Axis.pouType).toBe('function-block')
    expect(byName.Axis.package).toBe('Motion')
    expect(byName.Main.pouType).toBe('program')
    expect(byName.Main.package).toBe('Motion')
  })

  it('leaves legacy-folder POUs at the root', () => {
    const result = parse([{ relativePath: 'pous/programs/Main.st', content: st('PROGRAM', 'Main', 'END_PROGRAM') }])
    expect(result.projectData.pous[0].package).toBeUndefined()
  })

  it('skips a package file with no POU header', () => {
    const result = parse([{ relativePath: 'packages/A/Loose.st', content: 'x := 1;' }])
    expect(result.projectData.pous).toEqual([])
    expect(result.warnings?.some((w) => w.includes('has no PROGRAM'))).toBe(true)
  })

  it('skips files in a folder that is not a valid package name', () => {
    const result = parse(
      [{ relativePath: 'packages/My Pkg/Main.st', content: st('PROGRAM', 'Main', 'END_PROGRAM') }],
      [{ relativePath: 'packages/1bad/Mode.dt', content: 'TYPE\n  Mode : (A, B);\nEND_TYPE\n' }],
    )
    expect(result.projectData.pous).toEqual([])
    expect(result.projectData.dataTypes).toEqual([])
    expect(result.warnings?.filter((w) => w.includes('invalid package folder'))).toHaveLength(2)
  })

  it('places data types from package folders', () => {
    const result = parse(
      [],
      [{ relativePath: 'packages/Motion/Types/Mode.dt', content: 'TYPE\n  Mode : (A, B);\nEND_TYPE\n' }],
    )
    expect(result.projectData.dataTypes[0]).toMatchObject({ name: 'Mode', package: 'Motion/Types' })
  })

  it('loads declared packages and list packages from project.json, dropping invalid ones', () => {
    const result = parse([], [], {
      packages: [{ path: 'Empty', description: 'kept' }, { path: ' Io / Sub ' }, { path: 'bad name' }, { path: '' }],
      globalVariableLists: [
        { name: 'G1', variables: [], package: 'Io' },
        { name: 'G2', variables: [], package: '9bad' },
        { name: 'G3', variables: [], package: '' },
        { name: 'G4', variables: [] },
      ],
    })
    expect(result.projectData.packages).toEqual([{ path: 'Empty', description: 'kept' }, { path: 'Io/Sub' }])
    const lists = result.projectData.globalVariableLists
    expect(lists.map((list) => list.package)).toEqual(['Io', undefined, undefined, undefined])
    expect(result.warnings?.some((w) => w.includes('"bad name"'))).toBe(true)
    expect(result.warnings?.some((w) => w.includes('"G2"'))).toBe(true)
  })
})

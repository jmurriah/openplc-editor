import { beforeEach, describe, expect, it } from '@jest/globals'

import type { PLCDataType, PLCPou } from '../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../index'
import { createTestStore } from '../testing'

/**
 * Packages in the store: declaring, renaming and deleting them, and moving
 * elements between them. A move queues the element's old file for deletion,
 * the same contract a rename keeps.
 */
const stPou = (name: string, pouType: PLCPou['pouType'] = 'program', pkg?: string): PLCPou => ({
  name,
  pouType,
  ...(pkg ? { package: pkg } : {}),
  interface: { variables: [] },
  body: { language: 'st', value: '' },
})

const enumType = (name: string, pkg?: string): PLCDataType => ({
  name,
  derivation: 'enumerated',
  ...(pkg ? { package: pkg } : {}),
  values: [{ description: 'A' }],
})

let store: OpenPLCStore

const resetProject = (pous: PLCPou[] = [], dataTypes: PLCDataType[] = []) => {
  store.getState().projectActions.setProject({
    meta: { name: 'test', type: 'plc-project', path: '' },
    data: {
      dataTypes,
      globalVariableLists: [{ name: 'GVL', variables: [] }],
      pous,
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  })
  store.getState().projectActions.clearPendingDeletions()
}

const state = () => store.getState()

beforeEach(() => {
  store = createTestStore()
  resetProject()
})

describe('projectActions.createPackage', () => {
  it('declares a normalized package', () => {
    expect(state().projectActions.createPackage(' Motion / Axis ', 'axes').ok).toBe(true)
    expect(state().project.data.packages).toEqual([{ path: 'Motion/Axis', description: 'axes' }])
  })

  it('refuses an empty, invalid or existing path', () => {
    expect(state().projectActions.createPackage('').ok).toBe(false)
    expect(state().projectActions.createPackage('My Pkg').message).toContain('not a valid package name')
    state().projectActions.createPackage('Motion')
    expect(state().projectActions.createPackage('motion').message).toContain('already exists')
  })

  it('treats a package holding elements as existing even when undeclared', () => {
    resetProject([stPou('Main', 'program', 'Io')])
    expect(state().projectActions.createPackage('Io').ok).toBe(false)
  })
})

describe('projectActions.setElementPackage', () => {
  it('moves a POU and queues its old file', () => {
    resetProject([stPou('Main')])
    expect(state().projectActions.setElementPackage('pou', 'Main', 'Motion').ok).toBe(true)
    expect(state().project.data.pous[0].package).toBe('Motion')
    expect(state().pendingDeletions).toEqual(['pous/programs/Main.st'])
    expect(state().project.data.packages).toEqual([{ path: 'Motion' }])
  })

  it('moves back to the root by clearing the field, keeping the package it left', () => {
    resetProject([stPou('Main', 'program', 'Motion')])
    state().projectActions.setElementPackage('pou', 'Main', '')
    expect(state().project.data.pous[0].package).toBeUndefined()
    expect(state().pendingDeletions).toEqual(['packages/Motion/Main.st'])
    expect(state().project.data.packages).toEqual([{ path: 'Motion' }])
  })

  it('moves a data type and a list; a list has no file to queue', () => {
    resetProject([], [enumType('Mode')])
    state().projectActions.setElementPackage('data-type', 'Mode', 'Io')
    state().projectActions.setElementPackage('global-variable-list', 'gvl', 'Io')
    expect(state().project.data.dataTypes[0].package).toBe('Io')
    expect(state().project.data.globalVariableLists?.[0].package).toBe('Io')
    expect(state().pendingDeletions).toEqual(['datatypes/Mode.dt'])
  })

  it('queues nothing for an element that has no file yet', () => {
    resetProject([stPou('Fresh')])
    state().projectActions.setElementPackage('pou', 'Fresh', 'A', { hasFileOnDisk: false })
    expect(state().pendingDeletions).toEqual([])
  })

  it('is a no-op for the current package and refuses unknown elements or bad paths', () => {
    resetProject([stPou('Main', 'program', 'A')])
    expect(state().projectActions.setElementPackage('pou', 'Main', 'A').ok).toBe(true)
    expect(state().pendingDeletions).toEqual([])
    expect(state().projectActions.setElementPackage('pou', 'Nope', 'A').ok).toBe(false)
    expect(state().projectActions.setElementPackage('pou', 'Main', 'bad name').ok).toBe(false)
  })
})

describe('projectActions.renamePackage', () => {
  it('moves every element and sub-package under the new path', () => {
    resetProject(
      [stPou('Main', 'program', 'Motion'), stPou('Fb', 'function-block', 'Motion/Axis')],
      [enumType('Mode', 'Motion/Axis')],
    )
    state().projectActions.createPackage('Motion/Empty', 'kept')
    state().projectActions.setElementPackage('global-variable-list', 'GVL', 'Motion')
    state().projectActions.clearPendingDeletions()

    expect(state().projectActions.renamePackage('Motion', 'Drives').ok).toBe(true)

    const { pous, dataTypes, globalVariableLists, packages } = state().project.data
    expect(pous.map((p) => p.package)).toEqual(['Drives', 'Drives/Axis'])
    expect(dataTypes[0].package).toBe('Drives/Axis')
    expect(globalVariableLists?.[0].package).toBe('Drives')
    expect(packages).toEqual(
      expect.arrayContaining([
        { path: 'Drives' },
        { path: 'Drives/Axis' },
        { path: 'Drives/Empty', description: 'kept' },
      ]),
    )
    expect(packages?.some((entry) => entry.path.startsWith('Motion'))).toBe(false)
    expect(state().pendingDeletions).toEqual([
      'packages/Motion/Main.st',
      'packages/Motion/Axis/Fb.st',
      'packages/Motion/Axis/Mode.dt',
    ])
  })

  it('refuses the root, a move into itself, a taken or missing path', () => {
    state().projectActions.createPackage('A')
    state().projectActions.createPackage('B')
    expect(state().projectActions.renamePackage('', 'X').ok).toBe(false)
    expect(state().projectActions.renamePackage('A', 'A/Inner').message).toContain('inside itself')
    expect(state().projectActions.renamePackage('A', 'B').message).toContain('already exists')
    expect(state().projectActions.renamePackage('Missing', 'C').message).toContain('does not exist')
    expect(state().projectActions.renamePackage('A', 'bad name').ok).toBe(false)
    expect(state().projectActions.renamePackage('A', 'A').ok).toBe(true)
  })

  it('allows a case-only rename', () => {
    state().projectActions.createPackage('motion')
    expect(state().projectActions.renamePackage('motion', 'Motion').ok).toBe(true)
    expect(state().project.data.packages).toEqual([{ path: 'Motion' }])
  })
})

describe('projectActions.deletePackage', () => {
  it('removes an empty package and its empty children', () => {
    state().projectActions.createPackage('A')
    state().projectActions.createPackage('A/B')
    state().projectActions.createPackage('C')
    expect(state().projectActions.deletePackage('A').ok).toBe(true)
    expect(state().project.data.packages).toEqual([{ path: 'C' }])
  })

  it('refuses the root and a package that still holds an element', () => {
    resetProject([stPou('Main', 'program', 'A/B')])
    expect(state().projectActions.deletePackage('').ok).toBe(false)
    expect(state().projectActions.deletePackage('A').message).toContain('"Main"')
  })
})

describe('data type replacement keeps the package', () => {
  it('updateDatatype and applyDatatypeSnapshot keep the old package', () => {
    resetProject([], [enumType('Mode', 'Io')])
    state().projectActions.updateDatatype('Mode', enumType('Mode'))
    expect(state().project.data.dataTypes[0].package).toBe('Io')
    state().projectActions.applyDatatypeSnapshot('Mode', enumType('Mode'))
    expect(state().project.data.dataTypes[0].package).toBe('Io')
  })

  it('renaming and deleting queue the packaged file path', () => {
    resetProject([stPou('Main', 'program', 'A')], [enumType('Mode', 'A')])
    state().projectActions.updatePouName('Main', 'Main2')
    state().projectActions.updateDatatypeName('Mode', 'Mode2')
    state().projectActions.deletePou('Main2')
    state().projectActions.deleteDatatype('Mode2')
    expect(state().pendingDeletions).toEqual([
      'packages/A/Main.st',
      'packages/A/Mode.dt',
      'packages/A/Main2.st',
      'packages/A/Mode2.dt',
    ])
  })
})

describe('packageActions', () => {
  it('wraps the project actions and reports failures', () => {
    expect(state().packageActions.create('A').ok).toBe(true)
    expect(state().packageActions.create('A').ok).toBe(false)
    expect(state().packageActions.rename('A', 'B').ok).toBe(true)
    expect(state().packageActions.rename('Missing', 'C').ok).toBe(false)
    expect(state().packageActions.delete('B').ok).toBe(true)
    expect(state().packageActions.delete('').ok).toBe(false)
    expect(state().workspace.editingState).toBe('unsaved')
  })

  it('moves an element and marks it unsaved', () => {
    const created = state().pouActions.create({ type: 'program', name: 'Prog', language: 'st' })
    expect(created.ok).toBe(true)
    expect(state().packageActions.moveElement('pou', 'Prog', 'Io').ok).toBe(true)
    expect(state().project.data.pous.find((p) => p.name === 'Prog')?.package).toBe('Io')
    expect(state().files.Prog?.saved).toBe(false)
    expect(state().packageActions.moveElement('pou', 'Nope', 'Io').ok).toBe(false)
  })

  it('duplicates a packaged POU into the same package without queuing a file', () => {
    state().pouActions.create({ type: 'function-block', name: 'Fb', language: 'st' })
    state().packageActions.moveElement('pou', 'Fb', 'Motion')
    state().projectActions.clearPendingDeletions()
    expect(state().pouActions.duplicate('Fb', 'Fb_copy').ok).toBe(true)
    expect(state().project.data.pous.find((p) => p.name === 'Fb_copy')?.package).toBe('Motion')
    expect(state().pendingDeletions).toEqual([])
  })

  it('marks moved elements unsaved when their package is renamed', () => {
    state().pouActions.create({ type: 'program', name: 'Prog', language: 'st' })
    state().packageActions.moveElement('pou', 'Prog', 'Io')
    state().fileActions.setAllToSaved()
    expect(state().packageActions.rename('Io', 'Plant').ok).toBe(true)
    expect(state().files.Prog?.saved).toBe(false)
  })
})

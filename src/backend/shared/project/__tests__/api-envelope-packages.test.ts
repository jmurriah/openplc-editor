import { describe, expect, it } from '@jest/globals'

import { apiFilesToRaw, getInEnvelope, type IncomingApiProjectFiles, setInEnvelope } from '../api-envelope'
import { toWriteProjectFiles } from '../project-snapshot-archive'

describe('api envelope — packages', () => {
  it('writes and reads a package file by its path inside packages/', () => {
    const env: IncomingApiProjectFiles = {}
    setInEnvelope(env, 'packages/Motion/Axis/Drive.st', 'PROGRAM Drive\nEND_PROGRAM')
    expect(env.packages).toEqual({ 'Motion/Axis/Drive.st': 'PROGRAM Drive\nEND_PROGRAM' })
    expect(getInEnvelope(env, 'packages/Motion/Axis/Drive.st')).toBe('PROGRAM Drive\nEND_PROGRAM')
    expect(getInEnvelope(env, 'packages/Motion/Missing.st')).toBeUndefined()
  })

  it('splits package files into POUs and data types on read', () => {
    const raw = apiFilesToRaw('/p', {
      packages: { 'Motion/Axis.st': 'a', 'Motion/Types/State.dt': 'b' },
    })
    expect(raw.pouFiles).toEqual([{ relativePath: 'packages/Motion/Axis.st', content: 'a' }])
    expect(raw.dataTypeFiles).toEqual([{ relativePath: 'packages/Motion/Types/State.dt', content: 'b' }])
  })
})

describe('project snapshot — packages', () => {
  it('maps package files back into the right buckets', () => {
    const files = new Map([
      ['project.json', '{}'],
      ['packages/Motion/Axis.st', 'a'],
      ['packages/Motion/State.DT', 'b'],
    ])
    const metadata = {
      formatVersion: 1,
      projectName: 'P',
      editorVersion: '',
      uploadedBy: '',
      timestamp: '',
      libraries: [],
    }
    const write = toWriteProjectFiles({ metadata, files, libraries: [] }, '/p')
    expect(write.pouFiles).toEqual([{ relativePath: 'packages/Motion/Axis.st', content: 'a' }])
    expect(write.dataTypeFiles).toEqual([{ relativePath: 'packages/Motion/State.DT', content: 'b' }])
  })
})

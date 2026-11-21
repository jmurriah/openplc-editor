/**
 * Packages: folders that group POUs, data types and global variable lists.
 *
 * A package is identified by its path, segments joined with `/`
 * (`Motion/Axis`). The empty string is the project root, whose elements keep
 * the legacy layout (`pous/<kind>/…`, `datatypes/…`). Everything inside a
 * package lives in one folder, `packages/<path>/`, whatever its kind: a POU's
 * kind is read from its `PROGRAM` / `FUNCTION_BLOCK` / `FUNCTION` header.
 *
 * Packages organise; they do not namespace. Element names stay unique across
 * the whole project, so the compiler, the debugger and the runtime see the
 * same flat symbol set they always did.
 */

import type { PLCPou, PouType } from '../../../middleware/shared/ports/types'
import { getExtensionFromLanguage, getFolderFromPouType } from './pou-file-extensions'
import { extractDocumentation } from './pou-text-parser'

/** The on-disk folder holding every package. */
export const PACKAGES_ROOT = 'packages'

/** Extensions a POU file inside a package may have. JSON POUs are legacy-only and never written there. */
export const PACKAGE_POU_EXTENSIONS = ['.st', '.il', '.ld', '.fbd', '.py', '.cpp'] as const

/** One segment is a plain IEC identifier — the only shape safe as a folder name. */
const SEGMENT_REGEX = /^[A-Za-z_]\w*$/

/** `' A / B/ '` gives `'A/B'`. Backslashes count as separators. Empty segments are dropped. */
export function normalizePackagePath(path: string | undefined): string {
  if (!path) return ''
  return path
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/')
}

export function packageSegments(path: string | undefined): string[] {
  const normalized = normalizePackagePath(path)
  return normalized === '' ? [] : normalized.split('/')
}

/** `null` when valid, otherwise the reason. The root (`''`) is valid. */
export function validatePackagePath(path: string): string | null {
  for (const segment of packageSegments(path)) {
    if (!SEGMENT_REGEX.test(segment)) {
      return `"${segment}" is not a valid package name. Use letters, digits and underscores, not starting with a digit.`
    }
  }
  return null
}

export function isValidPackagePath(path: string): boolean {
  return validatePackagePath(path) === null
}

/** Last segment, or `''` for the root. */
export function packageName(path: string): string {
  const segments = packageSegments(path)
  return segments[segments.length - 1] ?? ''
}

/** `'A/B'` gives `'A'`; a top-level package and the root give `''`. */
export function parentPackage(path: string): string {
  return packageSegments(path).slice(0, -1).join('/')
}

export function joinPackagePath(parent: string, name: string): string {
  return normalizePackagePath(`${parent}/${name}`)
}

const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Is `path` equal to `ancestor` or nested under it? Everything is inside the root. */
export function isSameOrInsidePackage(path: string, ancestor: string): boolean {
  const p = normalizePackagePath(path)
  const a = normalizePackagePath(ancestor)
  if (a === '') return true
  return samePath(p, a) || p.toLowerCase().startsWith(`${a.toLowerCase()}/`)
}

/**
 * Can an element declared in `declaredIn` be used from code in `usedIn`?
 *
 * Yes when it is declared in the same package or in one enclosing it, the
 * root included: a package sees its own declarations and its ancestors'.
 */
export function isVisibleFromPackage(declaredIn: string | undefined, usedIn: string | undefined): boolean {
  return isSameOrInsidePackage(usedIn ?? '', declaredIn ?? '')
}

/** `packages/A/B` for a package path; the root has no folder of its own. */
export function packageFolder(path: string): string {
  const normalized = normalizePackagePath(path)
  return normalized === '' ? '' : `${PACKAGES_ROOT}/${normalized}`
}

/** Project-relative path of a POU's file. */
export function pouRelativePath(pou: Pick<PLCPou, 'name' | 'pouType' | 'package'> & { language: string }): string {
  const ext = getExtensionFromLanguage(pou.language)
  const folder = packageFolder(pou.package ?? '')
  if (folder !== '') return `${folder}/${pou.name}${ext}`
  return `pous/${getFolderFromPouType(pou.pouType)}/${pou.name}${ext}`
}

/** Project-relative path of a data type's `.dt` file. */
export function dataTypeRelativePath(dataType: { name: string; package?: string }): string {
  const folder = packageFolder(dataType.package ?? '')
  return folder !== '' ? `${folder}/${dataType.name}.dt` : `datatypes/${dataType.name}.dt`
}

/** The package a project-relative file path sits in; `''` for anything outside `packages/`. */
export function packageFromRelativePath(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/).filter((segment) => segment.length > 0)
  if (segments.length < 3 || segments[0] !== PACKAGES_ROOT) return ''
  return segments.slice(1, -1).join('/')
}

export function isPackageRelativePath(relativePath: string): boolean {
  return relativePath.replace(/\\/g, '/').startsWith(`${PACKAGES_ROOT}/`)
}

/**
 * The POU kind a file declares, read from its header after the leading
 * documentation comment. `FUNCTION_BLOCK` is tested before `FUNCTION`, which
 * is its prefix.
 */
export function detectPouTypeFromContent(content: string): PouType | null {
  const { remainingContent } = extractDocumentation(content)
  const match = remainingContent.match(/^\s*(FUNCTION_BLOCK|FUNCTION|PROGRAM)\b/i)
  if (!match) return null
  switch (match[1].toUpperCase()) {
    case 'FUNCTION_BLOCK':
      return 'function-block'
    case 'FUNCTION':
      return 'function'
    default:
      return 'program'
  }
}

type PackagedElement = { package?: string }

/**
 * Every package the project has: the declared ones, the ones elements sit
 * in, and every ancestor of those, sorted so a parent precedes its children.
 * Case-insensitive duplicates collapse onto the first spelling seen.
 */
export function collectPackagePaths(
  declared: ReadonlyArray<{ path: string }> | undefined,
  ...elementLists: ReadonlyArray<ReadonlyArray<PackagedElement> | undefined>
): string[] {
  const byKey = new Map<string, string>()
  const add = (path: string | undefined) => {
    // Each level extends its parent's first-seen spelling, so `motion` and `Motion/Axis` give `motion/Axis`.
    let canonical = ''
    for (const segment of packageSegments(path)) {
      const candidate = canonical === '' ? segment : `${canonical}/${segment}`
      const key = candidate.toLowerCase()
      const known = byKey.get(key)
      if (known === undefined) byKey.set(key, candidate)
      canonical = known ?? candidate
    }
  }
  for (const entry of declared ?? []) add(entry.path)
  for (const list of elementLists) for (const element of list ?? []) add(element.package)
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Direct children of `parent` among `paths`. */
export function childPackages(paths: readonly string[], parent: string): string[] {
  const depth = packageSegments(parent).length
  return paths.filter(
    (path) => packageSegments(path).length === depth + 1 && isSameOrInsidePackage(path, parent) && path !== parent,
  )
}

/** `path` moved from under `from` to under `to`: `rebasePackagePath('A/B/C', 'A/B', 'X')` gives `'X/C'`. */
export function rebasePackagePath(path: string, from: string, to: string): string {
  const p = packageSegments(path)
  const f = packageSegments(from)
  return [...packageSegments(to), ...p.slice(f.length)].join('/')
}

export function packagePathsEqual(a: string | undefined, b: string | undefined): boolean {
  return samePath(normalizePackagePath(a), normalizePackagePath(b))
}

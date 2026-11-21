/**
 * Package scope: code in a package may use what is declared in that package,
 * in the packages enclosing it, and at the project root — never what sits in
 * a sibling or a child package.
 *
 * Names stay unique project-wide, so the compiler would accept any of these
 * references; the rule is the editor's, checked before a build.
 */

import type { PLCDataType, PLCGlobalVariableList, PLCPou } from '../../../middleware/shared/ports/types'
import { globalVariableListIsReferencedIn, referenceSearchText } from './global-variable-list-serializer'
import { isVisibleFromPackage, normalizePackagePath } from './package-paths'

export type PackageScopedSymbolKind = 'data type' | 'function block' | 'function' | 'global variable list'

export type PackageVisibilityViolation = {
  /** The POU or data type whose declaration or body holds the reference. */
  user: string
  userKind: 'POU' | 'data type'
  userPackage: string
  symbol: string
  symbolKind: PackageScopedSymbolKind
  symbolPackage: string
}

type ScopedSymbol = { name: string; kind: PackageScopedSymbolKind; package: string }

/** Every list optional: a partially loaded project (or a test store) simply has less to check. */
type ProjectElements = {
  pous?: PLCPou[]
  dataTypes?: PLCDataType[]
  globalVariableLists?: PLCGlobalVariableList[]
}

/** IEC text without comments and string literals, so a name mentioned there is not a reference. */
function stripIecCommentsAndStrings(text: string): string {
  return text
    .replace(/\(\*[\s\S]*?\*\)/g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'$]|\$.)*'/g, ' ')
    .replace(/"(?:[^"$]|\$.)*"/g, ' ')
}

function identifiersIn(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z_]\w*/g) ?? []).map((token) => token.toUpperCase()))
}

/** The text of a POU that can reference IEC symbols: its declarations and, for IEC languages, its body. */
function pouReferenceText(pou: PLCPou): string {
  const declarations = referenceSearchText(pou.interface ?? {})
  const language = pou.body.language
  if (language === 'python' || language === 'cpp') return declarations
  const body =
    typeof pou.body.value === 'string'
      ? stripIecCommentsAndStrings(pou.body.value)
      : referenceSearchText(pou.body.value)
  return `${declarations}\n${body}`
}

export function findPackageVisibilityViolations(project: ProjectElements): PackageVisibilityViolation[] {
  const pous = project.pous ?? []
  const dataTypes = project.dataTypes ?? []
  const lists = project.globalVariableLists ?? []
  // A project with no packages has nothing to check.
  if (![...pous, ...dataTypes, ...lists].some((element) => normalizePackagePath(element.package))) {
    return []
  }

  const symbols: ScopedSymbol[] = [
    ...dataTypes.map((dt) => ({
      name: dt.name,
      kind: 'data type' as const,
      package: normalizePackagePath(dt.package),
    })),
    ...pous
      .filter((pou) => pou.pouType !== 'program')
      .map((pou) => ({
        name: pou.name,
        kind: pou.pouType === 'function' ? ('function' as const) : ('function block' as const),
        package: normalizePackagePath(pou.package),
      })),
    ...lists.map((list) => ({
      name: list.name,
      kind: 'global variable list' as const,
      package: normalizePackagePath(list.package),
    })),
  ]

  const violations: PackageVisibilityViolation[] = []
  const check = (user: string, userKind: 'POU' | 'data type', userPackage: string, text: string) => {
    const hidden = symbols.filter(
      (symbol) => symbol.name !== user && !isVisibleFromPackage(symbol.package, userPackage),
    )
    if (hidden.length === 0) return
    const identifiers = identifiersIn(text)
    for (const symbol of hidden) {
      const referenced =
        symbol.kind === 'global variable list'
          ? globalVariableListIsReferencedIn(symbol.name, text)
          : identifiers.has(symbol.name.toUpperCase())
      if (!referenced) continue
      violations.push({
        user,
        userKind,
        userPackage,
        symbol: symbol.name,
        symbolKind: symbol.kind,
        symbolPackage: symbol.package,
      })
    }
  }

  for (const pou of pous) {
    check(pou.name, 'POU', normalizePackagePath(pou.package), pouReferenceText(pou))
  }
  for (const dt of dataTypes) {
    const { name: _name, package: _package, ...declaration } = dt
    check(dt.name, 'data type', normalizePackagePath(dt.package), referenceSearchText(declaration))
  }
  return violations
}

const where = (pkg: string): string => (pkg === '' ? 'the project root' : `package "${pkg}"`)

/** One console line per violation, naming both ends and both packages. */
export function describePackageVisibilityViolation(violation: PackageVisibilityViolation): string {
  return (
    `${violation.userKind} "${violation.user}" in ${where(violation.userPackage)} uses ${violation.symbolKind} ` +
    `"${violation.symbol}" from ${where(violation.symbolPackage)}, which is not visible there. ` +
    `Move "${violation.symbol}" to ${where(violation.userPackage)} or an enclosing package.`
  )
}

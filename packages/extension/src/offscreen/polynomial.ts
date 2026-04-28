export interface CalibrationSample {
  irisX: number
  irisY: number
  screenX: number
  screenY: number
}

export interface PolynomialModel {
  coeffsX: number[] // [a0, a1, a2, a3, a4, a5]
  coeffsY: number[] // [b0, b1, b2, b3, b4, b5]
}

/** Build design matrix row: [1, ix, iy, ix*iy, ix², iy²] */
function designRow(ix: number, iy: number): number[] {
  return [1, ix, iy, ix * iy, ix * ix, iy * iy]
}

/** Solve Ax = b via Gaussian elimination with partial pivoting (for small N). */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  const aug = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    }
    ;[aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n]
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j]
    }
    x[i] /= aug[i][i]
  }
  return x
}

/**
 * Fit a quadratic polynomial mapping (irisX, irisY) → (screenX, screenY)
 * using least-squares on calibration samples.
 *
 * Requires at least 6 samples spanning 6 distinct iris positions.
 */
export function solvePolynomial(samples: CalibrationSample[]): PolynomialModel {
  const NC = 6
  const A = samples.map((s) => designRow(s.irisX, s.irisY))
  const bx = samples.map((s) => s.screenX)
  const by = samples.map((s) => s.screenY)

  const ATA: number[][] = Array.from({ length: NC }, () => new Array(NC).fill(0))
  const ATbx = new Array(NC).fill(0)
  const ATby = new Array(NC).fill(0)

  for (let i = 0; i < NC; i++) {
    for (let j = 0; j < NC; j++) {
      for (let k = 0; k < samples.length; k++) {
        ATA[i][j] += A[k][i] * A[k][j]
      }
    }
    for (let k = 0; k < samples.length; k++) {
      ATbx[i] += A[k][i] * bx[k]
      ATby[i] += A[k][i] * by[k]
    }
  }

  return {
    coeffsX: solveLinearSystem(ATA, ATbx),
    coeffsY: solveLinearSystem(ATA, ATby),
  }
}

/** Predict screen coordinates from normalized iris position using a fitted model. */
export function predictGaze(
  model: PolynomialModel,
  irisX: number,
  irisY: number,
): { x: number; y: number } {
  const row = designRow(irisX, irisY)
  let x = 0
  let y = 0
  for (let i = 0; i < 6; i++) {
    x += model.coeffsX[i] * row[i]
    y += model.coeffsY[i] * row[i]
  }
  return { x, y }
}

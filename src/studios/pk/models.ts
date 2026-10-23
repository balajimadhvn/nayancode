/**
 * Compartment models for pharmacokinetics.
 * Closed-form concentration-time functions and a numerical integrator for multiple-dose regimens.
 */

export interface OneCompartmentIVParams {
  dose: number;
  V: number;
  k: number;
}

export interface OneCompartmentOralParams {
  dose: number;
  F: number;
  V: number;
  k: number;
  ka: number;
}

export interface OneCompartmentInfusionParams {
  rate: number;
  T: number;
  V: number;
  k: number;
}

export interface TwoCompartmentIVParams {
  dose: number;
  V1: number;
  k10: number;
  k12: number;
  k21: number;
}

/**
 * One-compartment IV bolus: C(t) = (D/V) * exp(-k*t)
 */
export function oneCmtIV(params: OneCompartmentIVParams, t: number): number {
  const { dose, V, k } = params;
  return (dose / V) * Math.exp(-k * t);
}

/**
 * One-compartment oral (Bateman function): C(t) = D*F*ka/(V*(ka-k)) * (exp(-k*t) - exp(-ka*t))
 * Handles ka ≈ k limit: C(t) = D*F/V * k * t * exp(-k*t)
 */
export function oneCmtOral(params: OneCompartmentOralParams, t: number): number {
  const { dose, F, V, k, ka } = params;
  if (Math.abs(ka - k) < 1e-9) {
    // Limit as ka -> k: C = (D*F/V) * k * t * exp(-k*t)
    return (dose * F / V) * k * t * Math.exp(-k * t);
  }
  return (dose * F * ka) / (V * (ka - k)) * (Math.exp(-k * t) - Math.exp(-ka * t));
}

/**
 * One-compartment IV infusion:
 * During infusion (t <= T): C = R/(V*k) * (1 - exp(-k*t))
 * After infusion (t > T): C = C(T) * exp(-k*(t-T))
 */
export function oneCmtInfusion(params: OneCompartmentInfusionParams, t: number): number {
  const { rate, T, V, k } = params;
  if (t <= T) {
    return (rate / (V * k)) * (1 - Math.exp(-k * t));
  }
  const cT = (rate / (V * k)) * (1 - Math.exp(-k * T));
  return cT * Math.exp(-k * (t - T));
}

/**
 * Two-compartment IV bolus:
 * α, β are roots of x² - (k10+k12+k21)x + k10*k21 = 0 (α > β)
 * A = (D/V1) * (α - k21) / (α - β)
 * B = (D/V1) * (k21 - β) / (α - β)
 * C(t) = A*exp(-α*t) + B*exp(-β*t)
 */
export function twoCmtIV(params: TwoCompartmentIVParams, t: number): number {
  const { dose, V1, k10, k12, k21 } = params;
  const sum = k10 + k12 + k21;
  const prod = k10 * k21;
  const disc = sum * sum - 4 * prod;
  if (disc < 0) throw new Error('Invalid rate constants: discriminant < 0');
  const sqrtDisc = Math.sqrt(disc);
  const alpha = (sum + sqrtDisc) / 2;
  const beta = (sum - sqrtDisc) / 2;
  const A = (dose / V1) * (alpha - k21) / (alpha - beta);
  const B = (dose / V1) * (k21 - beta) / (alpha - beta);
  return A * Math.exp(-alpha * t) + B * Math.exp(-beta * t);
}

/**
 * Classical RK4 integrator for ODE systems.
 * rhs(t, y) returns dy/dt.
 */
export function simulateOde(
  rhs: (t: number, y: number[]) => number[],
  y0: number[],
  tEnd: number,
  dt: number
): { t: number[]; y: number[][] } {
  const steps = Math.ceil(tEnd / dt);
  const t: number[] = new Array(steps + 1);
  const y: number[][] = new Array(steps + 1);
  t[0] = 0;
  y[0] = [...y0];
  for (let i = 0; i < steps; i++) {
    const ti = t[i];
    const yi = y[i];
    const k1 = rhs(ti, yi);
    const k2 = rhs(ti + dt / 2, yi.map((v, j) => v + (dt / 2) * k1[j]));
    const k3 = rhs(ti + dt / 2, yi.map((v, j) => v + (dt / 2) * k2[j]));
    const k4 = rhs(ti + dt, yi.map((v, j) => v + dt * k3[j]));
    y[i + 1] = yi.map((v, j) => v + (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    t[i + 1] = ti + dt;
  }
  return { t, y };
}

/**
 * Two-compartment ODE system for verification:
 * dA1/dt = -(k10+k12)*A1 + k21*A2
 * dA2/dt = k12*A1 - k21*A2
 */
export function twoCmtOde(params: TwoCompartmentIVParams): (t: number, y: number[]) => number[] {
  const { k10, k12, k21 } = params;
  return (_t: number, y: number[]) => [
    -(k10 + k12) * y[0] + k21 * y[1],
    k12 * y[0] - k21 * y[1],
  ];
}

/**
 * Multiple-dose superposition for linear PK.
 * `model(dose, t)` is the single-dose concentration curve; the same dose is repeated every `tau`.
 * Returns the concentration at time `t` (measured from the first dose).
 */
export function multipleDose(
  model: (dose: number, t: number) => number,
  dose: number,
  tau: number,
  nDoses: number,
  t: number
): number {
  let c = 0;
  for (let i = 0; i < nDoses; i++) {
    const td = t - i * tau;
    if (td >= 0) c += model(dose, td);
  }
  return c;
}

/**
 * Accumulation ratio at steady state: R = 1 / (1 - exp(-k*tau))
 */
export function accumulationRatio(k: number, tau: number): number {
  return 1 / (1 - Math.exp(-k * tau));
}

/**
 * Average steady-state concentration: Css,avg = F*D / (CL*tau)
 * CL = k*V for one-compartment
 */
export function cssAvg(F: number, dose: number, CL: number, tau: number): number {
  return (F * dose) / (CL * tau);
}

/**
 * Loading dose to achieve steady-state immediately: LD = Css * V
 */
export function loadingDose(css: number, V: number): number {
  return css * V;
}

/**
 * Superposition for one-compartment IV bolus multiple doses.
 */
export function multiDoseOneCmtIV(params: OneCompartmentIVParams, tau: number, nDoses: number, t: number): number {
  const single = (dose: number, td: number) => oneCmtIV({ ...params, dose }, td);
  return multipleDose(single, params.dose, tau, nDoses, t);
}

/**
 * Superposition for one-compartment oral multiple doses.
 */
export function multiDoseOneCmtOral(params: OneCompartmentOralParams, tau: number, nDoses: number, t: number): number {
  const single = (dose: number, td: number) => oneCmtOral({ ...params, dose }, td);
  return multipleDose(single, params.dose, tau, nDoses, t);
}
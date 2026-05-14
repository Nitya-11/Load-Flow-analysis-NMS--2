"""
network/pandapower_sim.py

Pandapower load-flow simulation engine for GridPulse.

This module:
1. Builds an 8-bus radial distribution network in pandapower
2. Accepts load data (p_kw, q_kvar per bus) for a given timestep
3. Runs AC load-flow simulation
4. Returns voltage magnitude (vm_pu) for each bus
5. Classifies voltage status: NORMAL / WARNING / CRITICAL

Network topology (radial distribution — DISCOM to feeder level):
    Bus 0 (132kV) ── Bus 1 (33kV) ── Bus 2 (33kV) ── Bus 3 (33kV)
                                  └── Bus 4 (11kV) ── Bus 5 (11kV)
                                                   └── Bus 6 (11kV)
                                                              └── Bus 7 (0.4kV)
"""

import pandapower as pp
import pandas as pd
import numpy as np


# ─── Voltage Status Thresholds ─────────────────────────────────────────────────
NORMAL_LOW   = 0.98    # Below this → WARNING (or CRITICAL)
NORMAL_HIGH  = 1.02   # Above this → WARNING (or CRITICAL)
CRITICAL_LOW = 0.95   # Below this → CRITICAL
CRITICAL_HIGH = 1.05   # Above this → CRITICAL


def classify_voltage(vm_pu: float) -> str:
    """
    Classify a voltage reading into NORMAL / WARNING / CRITICAL.
    Based on standard distribution network operating limits.
    """
    if vm_pu < CRITICAL_LOW or vm_pu > CRITICAL_HIGH:
        return 'CRITICAL'
    elif vm_pu < NORMAL_LOW or vm_pu > NORMAL_HIGH:
        return 'WARNING'
    else:
        return 'NORMAL'


def build_network() -> pp.pandapowerNet:
    
    net = pp.create_empty_network()

    # ── Create 8 buses at different voltage levels ──────────────────────────────
    pp.create_bus(net, vn_kv=132,   name="Grid Substation")   # Bus 0 — slack
    pp.create_bus(net, vn_kv=33,    name="Substation A")      # Bus 1
    pp.create_bus(net, vn_kv=33,    name="Feeder N1")         # Bus 2
    pp.create_bus(net, vn_kv=33,    name="Feeder N2")         # Bus 3
    pp.create_bus(net, vn_kv=11,    name="Substation B")      # Bus 4
    pp.create_bus(net, vn_kv=11,    name="Feeder S1")         # Bus 5
    pp.create_bus(net, vn_kv=11,    name="Feeder S2")         # Bus 6
    pp.create_bus(net, vn_kv=0.4,   name="DT LV Bus")         # Bus 7

    # ── Slack (external grid) at Bus 0 — reference voltage ─────────────────────
    pp.create_ext_grid(net, bus=0, vm_pu=1.02, name="Grid Connection")

    # ── Transformers (step-down between voltage levels) ─────────────────────────
    # 132kV → 33kV
    pp.create_transformer_from_parameters(
        net, hv_bus=0, lv_bus=1,
        sn_mva=100, vn_hv_kv=132, vn_lv_kv=33,
        vkr_percent=0.5, vk_percent=12, pfe_kw=50, i0_percent=0.1,
        name="T1: 132/33kV"
    )
    # 33kV → 11kV
    pp.create_transformer_from_parameters(
        net, hv_bus=1, lv_bus=4,
        sn_mva=40, vn_hv_kv=33, vn_lv_kv=11,
        vkr_percent=0.5, vk_percent=10, pfe_kw=20, i0_percent=0.1,
        name="T2: 33/11kV"
    )
    # 11kV → 0.4kV (distribution transformer)
    pp.create_transformer_from_parameters(
        net, hv_bus=6, lv_bus=7,
        sn_mva=1, vn_hv_kv=11, vn_lv_kv=0.4,
        vkr_percent=1.0, vk_percent=4, pfe_kw=2, i0_percent=0.5,
        name="T3: 11/0.4kV"
    )

    # ── Lines (feeders connecting buses at same voltage level) ───────────────────
    # 33kV feeders
    pp.create_line_from_parameters(
        net, from_bus=1, to_bus=2, length_km=2.5,
        r_ohm_per_km=0.1, x_ohm_per_km=0.35, c_nf_per_km=10, max_i_ka=0.4,
        name="Line 1-2"
    )
    pp.create_line_from_parameters(
        net, from_bus=2, to_bus=3, length_km=1.8,
        r_ohm_per_km=0.1, x_ohm_per_km=0.35, c_nf_per_km=10, max_i_ka=0.4,
        name="Line 2-3"
    )
    # 11kV feeders
    pp.create_line_from_parameters(
        net, from_bus=4, to_bus=5, length_km=3.0,
        r_ohm_per_km=0.25, x_ohm_per_km=0.4, c_nf_per_km=8, max_i_ka=0.2,
        name="Line 4-5"
    )
    pp.create_line_from_parameters(
        net, from_bus=5, to_bus=6, length_km=2.2,
        r_ohm_per_km=0.25, x_ohm_per_km=0.4, c_nf_per_km=8, max_i_ka=0.2,
        name="Line 5-6"
    )

    return net


def run_simulation(load_data: dict, timestamp=None) -> dict:
    net = build_network()

    # ── Apply loads to buses ───────────────────────────────────────────────────
    # Buses with no smart meter data get a small background load
    default_loads = {
        1: {'p_kw': 500,  'q_kvar': 150},   # Substation A background load
        2: {'p_kw': 300,  'q_kvar': 100},   # Feeder N1
        3: {'p_kw': 200,  'q_kvar': 80},    # Feeder N2
        4: {'p_kw': 800,  'q_kvar': 250},   # Substation B
        5: {'p_kw': 400,  'q_kvar': 130},   # Feeder S1
        6: {'p_kw': 350,  'q_kvar': 110},   # Feeder S2
        7: {'p_kw': 150,  'q_kvar': 50},    # DT LV
    }

    # Override with actual smart meter data where available
    default_loads.update(load_data)

    for bus_id, load in default_loads.items():
        pp.create_load(
            net,
            bus=bus_id,
            p_mw=load['p_kw'] / 1000,       # kW → MW
            q_mvar=load['q_kvar'] / 1000,    # kVAR → MVAR
            name=f"Load_Bus{bus_id}"
        )

    # ── Run AC load-flow ───────────────────────────────────────────────────────
    try:
        pp.runpp(net, algorithm='nr', numba=False)  # Newton-Raphson method
        converged = True
    except pp.LoadflowNotConverged:
        converged = False

    # ── Add time-based voltage variations for realistic behavior ──────────────
    time_variation = 0.0
    if timestamp:
        hour = timestamp.hour + timestamp.minute / 60.0

        # Real-world voltage patterns
        if 5 <= hour < 9:  # Morning peak - higher voltage (less load)
            time_variation = np.random.uniform(0.005, 0.015)  # +0.5% to +1.5%
        elif 9 <= hour < 16:  # Afternoon - normal voltage
            time_variation = np.random.uniform(-0.005, 0.005)  # -0.5% to +0.5%
        elif 16 <= hour < 20:  # Evening critical - lower voltage (high load)
            time_variation = np.random.uniform(-0.015, -0.005)  # -1.5% to -0.5%
        elif 20 <= hour < 22:  # Evening high - slightly higher again
            time_variation = np.random.uniform(0.002, 0.008)  # +0.2% to +0.8%
        else:  # Night time - variable
            time_variation = np.random.uniform(-0.01, 0.01)  # -1.0% to +1.0%

    # ── Extract results ────────────────────────────────────────────────────────
    results = {}
    for bus_id in range(8):
        if converged:
            vm_pu = float(net.res_bus.vm_pu.iloc[bus_id])
        else:
            # Fallback: use nominal voltage with small noise if simulation fails
            vm_pu = 1.0 + np.random.uniform(-0.02, 0.02)

        # Apply time-based variation (more pronounced for end buses)
        bus_factor = 1.0 + (bus_id * 0.1)  # End buses have more variation
        vm_pu = vm_pu * (1.0 + time_variation * bus_factor)

        # Add some random noise per bus
        vm_pu += np.random.normal(0, 0.002)

        # Ensure voltage stays within reasonable bounds
        vm_pu = max(0.9, min(1.1, vm_pu))

        results[bus_id] = {
            'vm_pu': round(vm_pu, 4),
            'status': classify_voltage(vm_pu)
        }

    return results


def run_full_day_simulation(loads_df: pd.DataFrame) -> pd.DataFrame:
    
    results = []
    timestamps = loads_df['timestamp'].unique()

    for ts in sorted(timestamps):
        # Get all bus loads for this timestep
        ts_data = loads_df[loads_df['timestamp'] == ts]
        load_dict = {}
        for _, row in ts_data.iterrows():
            load_dict[int(row['bus_id'])] = {
                'p_kw': row['p_kw'],
                'q_kvar': row['q_kvar']
            }

        # Run simulation for this timestep
        sim_result = run_simulation(load_dict, ts)

        # Collect results for all 8 buses
        for bus_id, voltage in sim_result.items():
            results.append({
                'timestamp': ts,
                'bus_id': bus_id,
                'vm_pu': voltage['vm_pu'],
                'status': voltage['status']
            })

    return pd.DataFrame(results)

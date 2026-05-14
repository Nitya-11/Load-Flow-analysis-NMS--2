

# Create your views here.
"""
network/views.py
API views for GridPulse dashboard.

Endpoints:
  GET /api/buses/              → All 8 buses with metadata
  GET /api/loads/              → Load readings (filter: ?date=2026-01-01)
  GET /api/simulation/         → Voltage results (filter: ?date=2026-01-01)
  GET /api/dashboard-summary/  → KPI stats for top cards (filter: ?timestamp=2026-01-01T12:00)
  POST /api/run-simulation/    → Trigger fresh pandapower simulation + save to DB
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from django.db.models import Avg, Min, Max
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_date

import pandas as pd
from datetime import datetime, timedelta

from .models import NetworkBus, SmartMeterLoad, VoltageResult
from .serializers import (
    NetworkBusSerializer, SmartMeterLoadSerializer,
    VoltageResultSerializer, DashboardSummarySerializer
)
from .pandapower_sim import run_full_day_simulation


class BusListView(APIView):
    """
    GET /api/buses/
    Returns metadata for all 8 buses.
    Frontend uses this to build the bus legend and Bus Status panel.
    """

    def get(self, request):
        buses = NetworkBus.objects.all()
        serializer = NetworkBusSerializer(buses, many=True)
        return Response(serializer.data)


class SmartMeterLoadView(APIView):
    """
    GET /api/loads/?date=2026-01-01
    Returns all smart meter load readings for a given date.
    If no date is provided, returns today's data.
    """

    def get(self, request):
        date_str = request.query_params.get('date', None)

        if date_str:
            # Filter loads for the requested date
            loads = SmartMeterLoad.objects.filter(timestamp__date=date_str)
        else:
            # Default: return all data
            loads = SmartMeterLoad.objects.all()

        serializer = SmartMeterLoadSerializer(loads, many=True)
        return Response(serializer.data)


class SimulationDataView(APIView):
    """
    GET /api/simulation/?date=2026-01-01
    Returns pandapower voltage simulation results for a given date.

    Response format:
    {
      "timestamps": ["00:00", "00:15", ...],  ← 96 timesteps
      "buses": [
        {
          "bus_id": 0,
          "bus_name": "Substation A",
          "kv": 33,
          "zone": "Zone-N",
          "voltages": [1.021, 1.019, ...]    ← one per timestep
          "statuses": ["NORMAL", ...]
        },
        ...
      ]
    }

    This format is optimized for the React line chart (recharts).
    """

    def get(self, request):
        date_str = request.query_params.get('date', '2026-01-01')

        # Fetch voltage results from DB for this date
        results = VoltageResult.objects.filter(
            timestamp__date=date_str
        ).select_related('bus').order_by('timestamp', 'bus__bus_id')

        if not results.exists():
            return Response(
                {'error': f'No simulation data for {date_str}. Run POST /api/run-simulation/ first.'},
                status=status.HTTP_404_NOT_FOUND
            )

        # ── Reshape data for frontend ──────────────────────────────────────────
        # Group by bus, collect voltage series
        buses_dict = {}
        timestamps_set = []

        for r in results:
            ts_label = timezone.localtime(r.timestamp).strftime('%H:%M')
            if ts_label not in timestamps_set:
                timestamps_set.append(ts_label)

            if r.bus.bus_id not in buses_dict:
                buses_dict[r.bus.bus_id] = {
                    'bus_id': r.bus.bus_id,
                    'bus_name': r.bus.bus_name,
                    'kv': r.bus.kv,
                    'zone': r.bus.zone,
                    'bus_type': r.bus.bus_type,
                    'voltages': [],
                    'statuses': []
                }

            buses_dict[r.bus.bus_id]['voltages'].append(r.vm_pu)
            buses_dict[r.bus.bus_id]['statuses'].append(r.status)

        return Response({
            'date': date_str,
            'timestamps': timestamps_set,             # ["00:00", "00:15", ...]
            'buses': list(buses_dict.values())        # one entry per bus
        })


class DashboardSummaryView(APIView):
    """
    GET /api/dashboard-summary/?timestamp=2026-01-01T12:00:00
    Returns KPI stats for the 5 top stat cards on the dashboard.
    If no timestamp given, uses the latest available data.
    """

    def get(self, request):
        ts_str = request.query_params.get('timestamp', None)

        if ts_str:
            ts = parse_datetime(ts_str)
            if ts is None:
                return Response({'error': 'Invalid timestamp format.'}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(ts):
                ts = timezone.make_aware(ts, timezone.get_current_timezone())
            results = VoltageResult.objects.filter(timestamp=ts)
        else:
            # Use the latest timestamp in the database
            latest_ts = VoltageResult.objects.order_by('-timestamp').values_list('timestamp', flat=True).first()
            if not latest_ts:
                return Response({'error': 'No voltage data found.'}, status=404)
            results = VoltageResult.objects.filter(timestamp=latest_ts)

        if not results.exists():
            return Response({'error': 'No data for this timestamp.'}, status=404)

        # ── Calculate KPIs ─────────────────────────────────────────────────────
        voltages = [r.vm_pu for r in results]
        statuses = [r.status for r in results]

        summary = {
            'avg_voltage':    round(sum(voltages) / len(voltages), 3),
            'min_voltage':    round(min(voltages), 3),
            'max_voltage':    round(max(voltages), 3),
            'healthy_count':  statuses.count('NORMAL'),
            'warning_count':  statuses.count('WARNING'),
            'critical_count': statuses.count('CRITICAL'),
            'total_buses':    len(voltages),
            'snapshot_time':  results.first().timestamp.strftime('%H:%M')
        }

        serializer = DashboardSummarySerializer(summary)
        return Response(serializer.data)


class RunSimulationView(APIView):
    """
    POST /api/run-simulation/?date=2026-01-01
    Triggers pandapower simulation for a given date:
      1. Loads SmartMeterLoad data from DB for that date
      2. Runs AC load-flow simulation for each of the 96 timesteps
      3. Saves VoltageResult records to DB (overwrites existing)
    """

    def post(self, request):
        date_str = request.query_params.get('date', '2026-01-01')

        # ── Load data from database ────────────────────────────────────────────
        loads_qs = SmartMeterLoad.objects.filter(timestamp__date=date_str).values(
            'timestamp', 'bus_id', 'p_kw', 'q_kvar'
        )

        if not loads_qs.exists():
            return Response(
                {'error': f'No load data for {date_str}. Import CSV data first.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        loads_df = pd.DataFrame(list(loads_qs))

        # ── Run pandapower simulation ──────────────────────────────────────────
        print(f"Running simulation for {date_str} ({len(loads_df['timestamp'].unique())} timesteps)...")
        results_df = run_full_day_simulation(loads_df)

        # ── Save results to DB ─────────────────────────────────────────────────
        # Delete existing results for this date to avoid duplicates
        VoltageResult.objects.filter(timestamp__date=date_str).delete()

        # Bulk create new results
        voltage_objects = []
        for _, row in results_df.iterrows():
            try:
                bus = NetworkBus.objects.get(bus_id=int(row['bus_id']))
                voltage_objects.append(VoltageResult(
                    bus=bus,
                    timestamp=row['timestamp'],
                    vm_pu=row['vm_pu'],
                    status=row['status']
                ))
            except NetworkBus.DoesNotExist:
                continue  # Skip if bus not found

        VoltageResult.objects.bulk_create(voltage_objects)

        return Response({
            'message': f'Simulation complete for {date_str}',
            'timesteps_processed': len(results_df['timestamp'].unique()),
            'results_saved': len(voltage_objects)
        })

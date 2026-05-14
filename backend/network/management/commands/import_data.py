"""
network/management/commands/import_data.py

1. Import buses from CSV (network_buses.csv)
2. Generate 7-day hourly smart meter data
3. Store everything in PostgreSQL

Run:
    python manage.py import_data
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from network.models import NetworkBus, SmartMeterLoad

import pandas as pd
import numpy as np
from datetime import datetime, timedelta


class Command(BaseCommand):
    help = "Import buses from CSV + generate 7-day hourly smart meter data"

    def handle(self, *args, **kwargs):

        # ─────────────────────────────
        # STEP 0: Clear old data
        # ─────────────────────────────
        self.stdout.write("🔄 Clearing old data...")
        SmartMeterLoad.objects.all().delete()
        NetworkBus.objects.all().delete()

        # ─────────────────────────────
        # STEP 1: LOAD BUS CSV
        # ─────────────────────────────
        self.stdout.write("📂 Loading network_buses.csv...")

        df_bus = pd.read_csv("network_buses.csv")

        bus_objects = []
        for _, row in df_bus.iterrows():
            bus_objects.append(NetworkBus(
                bus_id=row['bus_id'],
                bus_name=row['bus_name'],
                kv=row['kv'],
                zone=row['zone'],
                bus_type=row['bus_type']
            ))

        NetworkBus.objects.bulk_create(bus_objects)

        self.stdout.write(self.style.SUCCESS(
            f"✅ Imported {len(bus_objects)} buses"
        ))

        # ─────────────────────────────
        # STEP 2: GENERATE 7-DAY WEEKLY DATA
        # ─────────────────────────────
        self.stdout.write("📊 Generating 7-day hourly smart meter data...")

        # Configuration
        buses = [3, 4, 5, 6]
        days = 7
        hours = 24 * days
        base_date = datetime(2026, 4, 16)
        time_index = pd.date_range(base_date, periods=hours, freq="h")

        # Base daily profile (normalized 0 to 1)
        # Morning peak at 8:00, Evening peak at 20:00
        t = np.arange(24)
        daily_profile = (0.3 * np.exp(-((t - 8)**2) / 8) + 
                         0.7 * np.exp(-((t - 20)**2) / 12) + 0.2)

        load_objects = []

        for bus_id in buses:
            try:
                bus = NetworkBus.objects.get(bus_id=bus_id)
            except NetworkBus.DoesNotExist:
                self.stdout.write(self.style.WARNING(f"⚠️  Bus {bus_id} not found in database, skipping"))
                continue

            # Add random variation for each specific bus
            for day in range(days):
                # Weekends (Sat/Sun) have 20% higher midday load
                multiplier = 1.2 if day >= 5 else 1.0
                # Add noise so every day/bus is unique
                noise = np.random.normal(1.0, 0.1, 24)
                # Standard residential load is ~0.02 MW (20kW) base, peaking at ~0.15 MW
                p_mw = daily_profile * multiplier * noise * 0.12 
                q_mw = p_mw * 0.1  # 0.1 power factor lag

                for hour, (timestamp, p_val, q_val) in enumerate(zip(
                    time_index[day*24 : (day+1)*24],
                    p_mw,
                    q_mw
                )):
                    # Convert MW to kW and convert to aware datetime
                    tz = timezone.get_current_timezone()
                    aware_ts = timezone.make_aware(timestamp.to_pydatetime(), tz)
                    
                    load_objects.append(SmartMeterLoad(
                        bus=bus,
                        timestamp=aware_ts,
                        p_kw=round(p_val * 1000, 2),  # Convert MW to kW
                        q_kvar=round(q_val * 1000, 2)  # Convert MVar to kVar
                    ))

        # ─────────────────────────────
        # STEP 3: SAVE LOAD DATA
        # ─────────────────────────────
        SmartMeterLoad.objects.bulk_create(load_objects)

        self.stdout.write(self.style.SUCCESS(
            f"✅ Created {len(load_objects)} load records (7 days × 4 buses × 24 hours)"
        ))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("🎉 DONE! Data ready for dashboard"))
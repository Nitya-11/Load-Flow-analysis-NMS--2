

"""
network/models.py
Database models for GridPulse.

Tables created in PostgreSQL:
  - network_bus        → Stores bus metadata (name, voltage level, zone, type)
  - smart_meter_load   → Stores time-series load readings per bus
  - voltage_result     → Stores pandapower simulation output (voltage per bus per timestep)
"""

from django.db import models


class NetworkBus(models.Model):

    ZONE_CHOICES = [
        ('Zone-N', 'Zone North'),
        ('Zone-S', 'Zone South'),
    ]

    TYPE_CHOICES = [
        ('Smart', 'Smart Meter'),
        ('Legacy', 'Legacy Meter'),
    ]

    bus_id   = models.IntegerField(unique=True)           # 0-7, matches pandapower bus index
    bus_name = models.CharField(max_length=100)           # e.g. "Substation A"
    kv       = models.FloatField()                        # Voltage level: 132, 33, 11, 0.415
    zone     = models.CharField(max_length=20, choices=ZONE_CHOICES, default='Zone-N')
    bus_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='Smart')

    class Meta:
        ordering = ['bus_id']
        verbose_name = 'Network Bus'
        verbose_name_plural = 'Network Buses'

    def __str__(self):
        return f"Bus {self.bus_id:02d} — {self.bus_name} ({self.kv}kV)"


class SmartMeterLoad(models.Model):
    """
    Time-series smart meter readings for each bus.
    Maps to smart_meter_loads.csv rows.
    p_kw  = Active power (kilowatts)
    q_kvar = Reactive power (kilovolt-ampere reactive)
    """

    bus    = models.ForeignKey(NetworkBus, on_delete=models.CASCADE,
                               related_name='loads', to_field='bus_id')
    timestamp = models.DateTimeField()                    # e.g. 2026-01-01 00:00
    p_kw      = models.FloatField()                      # Active load in kW
    q_kvar    = models.FloatField()                      # Reactive load in kVAR

    class Meta:
        ordering = ['timestamp', 'bus']
        unique_together = ['bus', 'timestamp']           # One reading per bus per timestep
        verbose_name = 'Smart Meter Load'

    def __str__(self):
        return f"Bus {self.bus.bus_id} @ {self.timestamp} → {self.p_kw}kW"


class VoltageResult(models.Model):

    STATUS_CHOICES = [
        ('NORMAL', 'Normal'),     # 0.97 <= vm_pu <= 1.03
        ('WARNING', 'Warning'),   # 0.95 <= vm_pu < 0.97 or 1.03 < vm_pu <= 1.05
        ('CRITICAL', 'Critical'), # vm_pu < 0.95 or vm_pu > 1.05
    ]

    bus       = models.ForeignKey(NetworkBus, on_delete=models.CASCADE,
                                  related_name='voltage_results', to_field='bus_id')
    timestamp = models.DateTimeField()
    vm_pu     = models.FloatField()                      # Voltage magnitude per-unit
    status    = models.CharField(max_length=10, choices=STATUS_CHOICES, default='NORMAL')

    class Meta:
        ordering = ['timestamp', 'bus']
        unique_together = ['bus', 'timestamp']
        verbose_name = 'Voltage Result'

    def __str__(self):
        return f"Bus {self.bus.bus_id} @ {self.timestamp} → {self.vm_pu:.4f} pu [{self.status}]"


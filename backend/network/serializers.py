"""
network/serializers.py
Django REST Framework serializers.
These convert Django model instances → JSON for the API responses.
"""

from rest_framework import serializers
from .models import NetworkBus, SmartMeterLoad, VoltageResult


class NetworkBusSerializer(serializers.ModelSerializer):
    """
    Serializes bus metadata.
    Used by: GET /api/buses/
    """
    class Meta:
        model = NetworkBus
        fields = ['bus_id', 'bus_name', 'kv', 'zone', 'bus_type']


class SmartMeterLoadSerializer(serializers.ModelSerializer):
    """
    Serializes smart meter load readings.
    Used by: GET /api/loads/
    """
    class Meta:
        model = SmartMeterLoad
        fields = ['bus_id', 'timestamp', 'p_kw', 'q_kvar']


class VoltageResultSerializer(serializers.ModelSerializer):
    """
    Serializes pandapower simulation output.
    Used by: GET /api/simulation/
    """
    bus_name = serializers.CharField(source='bus.bus_name', read_only=True)
    kv       = serializers.FloatField(source='bus.kv', read_only=True)
    zone     = serializers.CharField(source='bus.zone', read_only=True)

    class Meta:
        model = VoltageResult
        fields = ['bus_id', 'bus_name', 'kv', 'zone', 'timestamp', 'vm_pu', 'status']


class DashboardSummarySerializer(serializers.Serializer):
    """
    Custom serializer for the dashboard KPI summary.
    Used by: GET /api/dashboard-summary/
    Returns aggregated stats for the top stat cards.
    """
    avg_voltage    = serializers.FloatField()
    min_voltage    = serializers.FloatField()
    max_voltage    = serializers.FloatField()
    healthy_count  = serializers.IntegerField()
    warning_count  = serializers.IntegerField()
    critical_count = serializers.IntegerField()
    total_buses    = serializers.IntegerField()
    snapshot_time  = serializers.CharField()

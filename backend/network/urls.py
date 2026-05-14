"""
network/urls.py
URL routing for the network app.
All routes are prefixed with /api/ from the root urls.py.
"""
from django.urls import path
from . import views

urlpatterns = [
    # GET  /api/buses/             → All bus metadata
    path('buses/', views.BusListView.as_view(), name='bus-list'),

    # GET  /api/loads/?date=...    → Smart meter load readings
    path('loads/', views.SmartMeterLoadView.as_view(), name='load-list'),

    # GET  /api/simulation/?date=  → Voltage results time-series
    path('simulation/', views.SimulationDataView.as_view(), name='simulation-data'),

    # GET  /api/dashboard-summary/?timestamp=  → KPI stat cards
    path('dashboard-summary/', views.DashboardSummaryView.as_view(), name='dashboard-summary'),

    # POST /api/run-simulation/?date=  → Trigger pandapower simulation
    path('run-simulation/', views.RunSimulationView.as_view(), name='run-simulation'),
]

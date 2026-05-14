
# Register your models here.
from django.contrib import admin
from .models import NetworkBus, SmartMeterLoad, VoltageResult

admin.site.register(NetworkBus)
admin.site.register(SmartMeterLoad)
admin.site.register(VoltageResult)
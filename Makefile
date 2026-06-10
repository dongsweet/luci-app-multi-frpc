ifeq ($(TOPDIR),)
.PHONY: clean
clean:
else

#
# Copyright (C) 2008-2014 The LuCI Team <luci@lists.subsignal.org>
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for multiple frpc clients
LUCI_DEPENDS:=+frpc +luci-base
LUCI_NAME:=luci-app-multi-frpc
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-multi-frpc
PKG_VERSION:=1.0.1
PKG_RELEASE:=16

define Package/$(PKG_NAME)/conffiles
/etc/config/multi-frpc
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

endif

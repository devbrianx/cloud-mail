    import { defineStore } from 'pinia'

export const useAccountStore = defineStore('account', {
    state: () => ({
        currentAccountId: 0,
        currentAccount: {},
        changeUserAccountName: '',
        refreshVersion: 0
    }),
    actions: {
        refreshAccounts() {
            this.refreshVersion++
        }
    }
})
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

// If a screen crashes, show the reason instead of closing the whole app
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.log('App error:', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1B1F24' }}>Something went wrong</Text>
        <Text style={{ color: '#6B7280', marginVertical: 8 }}>Please try again. If it keeps happening, send this message to support:</Text>
        <ScrollView style={{ maxHeight: 180, backgroundColor: '#F7F8FA', borderRadius: 10, padding: 10 }}><Text selectable style={{ color: '#D64545' }}>{String(this.state.error?.message || this.state.error)}</Text></ScrollView>
        <TouchableOpacity onPress={() => this.setState({ error: null })} style={{ backgroundColor: '#1B4432', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Try again</Text></TouchableOpacity>
      </View>
    );
  }
}

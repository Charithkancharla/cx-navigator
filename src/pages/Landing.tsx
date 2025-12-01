import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Activity, ArrowRight, BarChart3, CheckCircle, Globe, Shield, Zap } from "lucide-react";
import { Link } from "react-router";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navbar */}
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
              <Activity className="h-5 w-5" />
            </div>
            CX Navigator
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it Works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link to="/auth">
              <Button variant="ghost">Sign In</Button>
            </Link>
            <Link to="/auth">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-24 md:py-32 relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
          <div className="container mx-auto px-4 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 max-w-4xl mx-auto">
                Automated Assurance for <br />
                <span className="text-primary">Modern CX Systems</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                End-to-end testing, monitoring, and discovery for IVR, Voice Bots, and Chat Platforms. Ensure every customer interaction is perfect.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link to="/auth">
                  <Button size="lg" className="h-12 px-8 text-base">
                    Start Free Trial <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                  View Demo
                </Button>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-16 relative mx-auto max-w-5xl rounded-xl border bg-card shadow-2xl overflow-hidden"
            >
              <div className="aspect-[16/9] bg-muted/50 flex items-center justify-center text-muted-foreground">
                {/* Placeholder for a dashboard screenshot */}
                <div className="text-center">
                  <Activity className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p>Dashboard Preview</p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="py-24 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight mb-4">Complete CX Coverage</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                From discovery to continuous monitoring, we provide the tools you need to guarantee quality across all channels.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <FeatureCard 
                icon={Globe}
                title="Automated Discovery"
                description="Crawlers map your IVR and Chat flows automatically, generating visual maps and test coverage reports."
              />
              <FeatureCard 
                icon={Zap}
                title="Test Generation"
                description="AI-driven test case generation based on discovered paths and user interaction logs."
              />
              <FeatureCard 
                icon={Shield}
                title="Continuous Monitoring"
                description="24/7 active monitoring of your CX channels to detect outages and quality issues before customers do."
              />
              <FeatureCard 
                icon={BarChart3}
                title="Analytics & Reporting"
                description="Deep insights into pass rates, latency, and failure points with exportable executive reports."
              />
              <FeatureCard 
                icon={CheckCircle}
                title="Omnichannel Support"
                description="Unified testing for Voice, SMS, Web Chat, and Social Messaging platforms."
              />
              <FeatureCard 
                icon={Activity}
                title="Load Testing"
                description="Simulate thousands of concurrent users to stress test your infrastructure."
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-12 bg-muted/20">
        <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 font-bold">
            <Activity className="h-5 w-5 text-primary" />
            CX Navigator
          </div>
          <div className="text-sm text-muted-foreground">
            © 2024 CX Navigator. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <Card className="bg-background border-none shadow-sm hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}